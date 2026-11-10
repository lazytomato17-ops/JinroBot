// src/db.ts
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { EmbedBuilder } from 'discord.js';
import { Player } from './types';
import * as Messages from './messages';
import * as Roles from './roles';


const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_KEY;

const supabase: SupabaseClient | null =
    supabaseUrl && supabaseKey && !supabaseUrl.startsWith('ここに')
        ? createClient(supabaseUrl, supabaseKey)
        : null;

export async function checkLegacyStorage(): Promise<void> {
    if (!supabase) throw new Error('Legacy rating storage is not configured');
    await Promise.all(['users', 'matches', 'match_players', 'presets', 'system_settings'].map(async (table) => {
        const { error } = await supabase!.from(table).select('*', { head: true }).limit(1);
        if (error) throw new Error(`Legacy storage check failed: ${table} (${error.code})`);
    }));
}

// テーブル構造:
// users        : id, name, rate, streak, is_premium, created_at, updated_at
// matches      : id, winner_team, match_type, player_count, created_at
// match_players: match_id, user_id, role, is_win, is_alive, rate_delta
// presets      : user_id, name, settings

function getRankInfo(rate: number) {
    if (rate >= 2400) return { name: 'レジェンド',       icon: '⚜️', color: 0xFFD700 };
    if (rate >= 2000) return { name: 'グランドマスター', icon: '👑', color: 0xFF0000 };
    if (rate >= 1800) return { name: 'ダイヤモンド',     icon: '💎', color: 0x00BFFF };
    if (rate >= 1700) return { name: 'プラチナ',         icon: '💿', color: 0xE5E4E2 };
    if (rate >= 1600) return { name: 'ゴールド',         icon: '🥇', color: 0xFFD700 };
    if (rate >= 1500) return { name: 'シルバー',         icon: '🥈', color: 0xC0C0C0 };
    if (rate >= 1400) return { name: 'ブロンズ',         icon: '🥉', color: 0xCD7F32 };
    return { name: 'ルーキー', icon: '🔰', color: 0x808080 };
}

function getPlayerKFactor(myRate: number, winningTeam: string, totalPlayers: number): number {
    let baseK = 32;
    
    // 1. レートに応じたK値の変動（初心者ほど上がりやすく、上級者ほど安定する）
    if (myRate < 1600) baseK = 40;
    else if (myRate < 2000) baseK = 32;
    else if (myRate < 2400) baseK = 24;
    else baseK = 16;

    // 2. 難易度の高い陣営での勝利ボーナス
    if (['fox', 'teruteru', 'lovers'].includes(winningTeam)) baseK += 18;
    else if (winningTeam === 'wolf') baseK += 6;

    // 3. 人数ボーナス（大人数村ほど勝つのが難しいため価値が高い）
    if (totalPlayers >= 8) baseK += 4;
    if (totalPlayers >= 12) baseK += 4;

    return baseK;
}

function calculateEloDelta(myRate: number, oppTeamAvg: number, kFactor: number, isWin: boolean): number {
    // 個人レートと相手チーム平均の差から「期待勝率」を正確に計算する
    const expected = 1 / (1 + Math.pow(10, (oppTeamAvg - myRate) / 400));
    let delta = Math.round(kFactor * ((isWin ? 1 : 0) - expected));
    
    // ★ ご要望の機能: 1〜3のランダムな揺らぎを追加
    const randomFluctuation = Math.floor(Math.random() * 3) + 1; // 1, 2, 3 のどれか
    if (isWin) {
        delta += randomFluctuation; // 勝った時は上振れ
    } else {
        delta -= randomFluctuation; // 負けた時は下振れ
    }

    return delta;
}

export function isPlayerWinning(p: Player, winnerTeam: string, lovers: string[], allPlayers: Player[] = [], devoteeTarget?: string): boolean {
    // 第三陣営の勝利判定（優先度高）
    if (winnerTeam === 'lovers' && lovers.includes(p.id)) return true;
    if (winnerTeam === 'fox'      && p.role === '妖狐')     return true;
    if (winnerTeam === 'teruteru' && p.role === 'テルテル') return true;

    // 純愛者の場合は、対象プレイヤーの勝利判定をコピーする
    if (p.role === '純愛者' && devoteeTarget) {
        const target = allPlayers.find(pl => pl.id === devoteeTarget);
        if (target && target.id !== p.id) {
            return isPlayerWinning(target, winnerTeam, lovers, allPlayers, devoteeTarget);
        }
    }

    // ★ 型エラー回避: as string で厳格な型チェックをバイパス
    const team = Roles.ROLE_CATALOG[p.role as string]?.team as string | undefined;
    
    if (team === winnerTeam) return true;
    if ((team === 'villager' || team === 'village') && (winnerTeam === 'villager' || winnerTeam === 'village')) return true;

    return false;
}

export async function getPlayersStats(
    userIds: string[]
): Promise<Record<string, { rate: number; streak: number }>> {
    const stats: Record<string, { rate: number; streak: number }> = {};
    if (!supabase || !userIds || userIds.length === 0) return stats;
    userIds.forEach(uid => { stats[uid] = { rate: 1500, streak: 0 }; });

    const { data, error } = await supabase.from('users').select('id, rate, streak').in('id', userIds);
    if (error) throw new Error(`Could not read legacy ratings (${error.code})`);
    (data ?? []).forEach((row: any) => {
        stats[row.id] = { rate: row.rate ?? 1500, streak: row.streak ?? 0 };
    });
    return stats;
}

export async function predictRatingChange(
    winnerTeam: string,
    players: Player[],
    lovers: string[],
    options: any,
    mvpName: string | null,
    currentStats: Record<string, { rate: number; streak: number }>,
    devoteeTarget?: string
): Promise<Record<string, number>> {
    if (!options.isRanked) return {};
    const LOSE_FACTOR = 0.6; // 敗北時のマイナス緩和係数
    const humans = players.filter(p => !p.isNpc);
    if (humans.length === 0) return {};
    
    const allHumansAvg = humans.reduce((s, p) => s + (currentStats[p.id]?.rate ?? 1500), 0) / humans.length;
    
    const winners = humans.filter(p =>  isPlayerWinning(p, winnerTeam, lovers, players, devoteeTarget));
    const losers  = humans.filter(p => !isPlayerWinning(p, winnerTeam, lovers, players, devoteeTarget));

    // 相手チームの平均レートを算出
    const winnerAvg = winners.length > 0 ? winners.reduce((s, p) => s + (currentStats[p.id]?.rate ?? 1500), 0) / winners.length : allHumansAvg;
    const loserAvg  = losers.length  > 0 ? losers.reduce((s, p)  => s + (currentStats[p.id]?.rate ?? 1500), 0) / losers.length  : allHumansAvg;

    const result: Record<string, number> = {};

    // 勝利チームの計算
    winners.forEach(p => {
        const streak = currentStats[p.id]?.streak ?? 0;
        const myRate = currentStats[p.id]?.rate ?? 1500;
        
        // 個人レートベースで計算
        const K = getPlayerKFactor(myRate, winnerTeam, players.length);
        let delta = calculateEloDelta(myRate, loserAvg, K, true);
        
        // 負の値を防ぐ
        if (delta < 0) delta = 0;
        
        // ボーナス加算
        if (streak >= 5) delta += 5;
        else if (streak >= 3) delta += 2;
        
        if (p.name === mvpName) delta += 5;
        
        // 💰 賭け(Ghost Bet)的中ボーナス（適正化）
        if (p.ghostBet) {
            let hit = false;
            if (p.ghostBet === 'villager' && winnerTeam === 'villager') hit = true;
            if (p.ghostBet === 'wolf' && winnerTeam === 'wolf') hit = true;
            if (p.ghostBet === 'other' && ['fox', 'lovers', 'teruteru'].includes(winnerTeam)) hit = true;
            
            if (hit) {
                // 大穴は+10、通常は+4のスパイス
                delta += (p.ghostBet === 'other') ? 10 : 4;
            }
        }
        
        result[p.id] = delta;
    });

    // 敗北チームの計算
    losers.forEach(p => {
        const myRate = currentStats[p.id]?.rate ?? 1500;
        
        // 個人レートベースで計算
        const K = getPlayerKFactor(myRate, winnerTeam, players.length);
        let delta = calculateEloDelta(myRate, winnerAvg, K, false);
        delta = Math.round(delta * LOSE_FACTOR); 
        
        // 保護措置
        if (myRate < 1400) delta = 0;
        else if (myRate < 1600) delta = Math.max(-8, delta);
        
        // 敗北側MVPへの救済措置
        if (p.name === mvpName) { 
            delta += 5; 
            if (delta > 0) delta = 0; 
        }

        // 💰 賭け(Ghost Bet)的中ボーナス（トロール防止キャップ付き）
        if (p.ghostBet) {
            let hit = false;
            if (p.ghostBet === 'villager' && winnerTeam === 'villager') hit = true;
            if (p.ghostBet === 'wolf' && winnerTeam === 'wolf') hit = true;
            if (p.ghostBet === 'other' && ['fox', 'lovers', 'teruteru'].includes(winnerTeam)) hit = true;
            
            if (hit) {
                delta += (p.ghostBet === 'other') ? 10 : 4;
                // ★ 最重要：負けた場合は、賭けを当てても「最大+2」までしか稼げないようにする
                if (delta > 2) delta = 2;
            }
        }
        
        result[p.id] = delta;
    });

    return result;
}
export async function saveGameResults(
    game: any,
    winningSide: string,
    mvpName: string | null
): Promise<{ deltas: Record<string, number> }> {
    if (!supabase) return { deltas: {} };

    // 引数を game オブジェクトから展開
    const players = game.players;
    const lovers = game.lovers || [];
    const isRanked = game.settings.matchType === 'ranked' && players.filter((p: Player) => !p.isNpc).length >= 2;
    const options = { isRanked, mvpName };

    const humanPlayers = players.filter((p: any) => !p.isNpc);
    const humanIds = humanPlayers.map((p: any) => p.id);
    
    // ★ここがダブらないようにスッキリ整理しました！
    const currentStats = await getPlayersStats(humanIds);
    const devoteeTarget = game.devoteeTarget;
    const deltas = await predictRatingChange(winningSide, players, lovers, options, mvpName, currentStats, devoteeTarget);

    // ==========================================
    // シーズン番号の取得
    // ==========================================
    let currentSeason = 1;
    const { data: seasonData } = await supabase
        .from('system_settings')
        .select('value')
        .eq('key', 'current_season')
        .single();
    if (seasonData) currentSeason = seasonData.value;

    // 1. matches テーブルに INSERT
    const { data: matchData, error: matchError } = await supabase
        .from('matches')
        .insert({ 
            winner_team: winningSide, 
            match_type: isRanked ? 'ranked' : 'casual', 
            player_count: players.length,
            season_id: currentSeason 
        })
        .select('id').single();

    if (matchError || !matchData) {
        console.error('[saveGameResults] matches insert error:', matchError);
        throw new Error('Could not save legacy match');
    }
    const matchId = matchData.id;

    // 2. match_players に INSERT
    const matchPlayerRows = humanPlayers.map((p: any) => ({
        match_id:   matchId,
        user_id:    p.id,
        role:       p.role ?? '不明',
        is_win:     isPlayerWinning(p, winningSide, lovers, players, devoteeTarget), // ★修正
        is_alive:   p.alive,
        rate_delta: isRanked ? (deltas[p.id] ?? 0) : 0,
    }));
    // 3. users テーブルを UPSERT
    const now = new Date().toISOString();
    const userUpsertRows = humanPlayers.map((p: any) => {
        const isWin    = isPlayerWinning(p, winningSide, lovers, players, devoteeTarget); // ★修正
        const oldRate  = currentStats[p.id]?.rate   ?? 1500;
        const oldStreak = currentStats[p.id]?.streak ?? 0;
        
        const avatarUrl = p.user ? p.user.displayAvatarURL({ extension: 'png', size: 256 }) : null;

        return {
            id:         p.id,
            name:       p.name,
            rate:       isRanked ? oldRate + (deltas[p.id] ?? 0) : oldRate,
            streak:     isWin ? oldStreak + 1 : 0,
            avatar_url: avatarUrl,
            updated_at: now,
        };
    });
    if (userUpsertRows.length > 0) {
        const { error: upsertError } = await supabase.from('users').upsert(userUpsertRows, { onConflict: 'id' });
        if (upsertError) throw new Error(`Could not save legacy rating (${upsertError.code})`);
    }

    // match_players references users, including players with no prior record.
    if (matchPlayerRows.length > 0) {
        const { error } = await supabase.from('match_players').insert(matchPlayerRows);
        if (error) throw new Error(`Could not save legacy player results (${error.code})`);
    }

    return { deltas };
}

export async function isPremiumUser(userId: string): Promise<boolean> {
    const plan = await getUserPlan(userId);
    return plan !== 'free';
}

export async function showStats(userId: string, interaction: any) {
    if (!supabase) return interaction.editReply('データベース未接続です。');

    const { data: userData } = await supabase.from('users').select('rate, streak').eq('id', userId).single();
    const myRate = userData?.rate  ?? 1500;
    const streak = userData?.streak ?? 0;

    // 全ユーザーを取得する代わりにDBで集計（負荷・転送量を大幅削減）
    const [{ count: totalPlayers }, { count: higherCount }] = await Promise.all([
        supabase.from('users').select('*', { count: 'exact', head: true }),
        supabase.from('users').select('*', { count: 'exact', head: true }).gt('rate', myRate),
    ]);
    const myRank = (higherCount ?? 0) + 1;
    const totalPlayersCount = totalPlayers ?? 1;
    
    const userPlan = await getUserPlan(userId);
    let premiumBadge = '';
    if (userPlan === 'founder') premiumBadge = ' [FOUNDER]';
    else if (userPlan === 'pro') premiumBadge = ' [PRO]';
    else if (userPlan === 'host') premiumBadge = ' [HOST]';
    else if (userPlan === 'supporter') premiumBadge = ' [SUPPORTER]'; // サポーターバッジも追加しておきました
    
    const rankInfo  = getRankInfo(myRate);
    const avatarUrl = interaction.user.displayAvatarURL({ extension: 'png', size: 256 });

    const { data: mpData } = await supabase.from('match_players').select('role, is_win, is_alive, rate_delta').eq('user_id', userId);
    const records = mpData ?? [];
    const total   = records.length;
    const wins    = records.filter((r: any) => r.is_win).length;
    const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : '0.0';

    if (total === 0) {
        const descZero = `**現在のレート**: 🏆 **${myRate}** (${myRank}位 / ${totalPlayersCount}人)\n\n` +
                         `まだ試合記録がありません。\nランクマッチに参加して最初の記録を刻みましょう！`;

        const embed = new EmbedBuilder()
            .setTitle(`📊 ${rankInfo.name} ${rankInfo.icon}${premiumBadge}`)
            .setDescription(descZero)
            .setThumbnail(avatarUrl)
            .setColor(rankInfo.color);
        return interaction.editReply({ embeds: [embed] });
    }

    const roleStats: Record<string, { played: number; won: number }> = {};
    records.forEach((r: any) => {
        if (!r.role) return;
        if (!roleStats[r.role]) roleStats[r.role] = { played: 0, won: 0 };
        roleStats[r.role].played++;
        if (r.is_win) roleStats[r.role].won++;
    });

    const desc = `**現在のレート**: 🏆 **${myRate}** (${myRank}位 / ${totalPlayersCount}人)\n` +
                 `**現在の連勝**: 🔥 **${streak}**\n\n` +
                 `**通算成績**\n` +
                 `試合: **${total}** 勝利: **${wins}**\n` +
                 `勝率: **${winRate}%**`;

    const embed = new EmbedBuilder()
        .setTitle(`📊 ${rankInfo.name} ${rankInfo.icon}${premiumBadge}`)
        .setDescription(desc)
        .setThumbnail(avatarUrl)
        .setColor(rankInfo.color);

    await interaction.editReply({ embeds: [embed] });
}

export async function getCurrentStreak(userId: string): Promise<number> {
    if (!supabase) return 0;
    const { data } = await supabase.from('users').select('streak').eq('id', userId).single();
    return data?.streak ?? 0;
}

// 💡 キャッシュ用の変数をファイル上部に追加
const presetCache = new Map<string, { data: any[], expires: number }>();

export async function getPresets(userId: string) {
    if (!supabase) return [];

    // 1. キャッシュが有効なら、DB通信せずに爆速で返す
    const cached = presetCache.get(userId);
    if (cached && cached.expires > Date.now()) {
        return cached.data;
    }

    // 2. キャッシュがなければ通常通りDBから取得
    const { data, error } = await supabase.from('presets').select('*').eq('user_id', userId).order('created_at', { ascending: true });
    if (error) { console.error(error); return []; }

    // 3. 取得したデータを5分間キャッシュに保存
    presetCache.set(userId, { data: data || [], expires: Date.now() + 1000 * 60 * 5 });
    return data || [];
}

export async function savePreset(userId: string, name: string, settings: any, userName: string = 'Player') {
    if (!supabase) return { success: false, message: 'DB未接続です。' };

    await supabase.from('users').upsert(
        { id: userId, name: userName, rate: 1500, streak: 0, updated_at: new Date().toISOString() }, 
        { onConflict: 'id', ignoreDuplicates: true }
    );

    const isPremium = await isPremiumUser(userId);
    if (!isPremium) return { success: false, message: '⚠️ **機能ロック中**\nオリジナルプリセットの保存はサポーター（VIP）以上向けに限定解放されています。' };
    
    const presets = await getPresets(userId);
    const existing = presets.find((p: any) => p.name === name);
    
    const maxPresets = 20;
    if (!existing && presets.length >= maxPresets) return { success: false, message: `⚠️ 保存枠の上限（最大${maxPresets}枠）に達しています。` };
    
    const { error } = await supabase.from('presets').upsert({ user_id: userId, name, settings }, { onConflict: 'user_id, name' });
    if (error) {
        console.error('[savePreset Error]', error);
        return { success: false, message: '保存時にエラーが発生しました。' };
    }
    return { success: true, message: `✅ プリセット「**${name}**」として保存しました！` };
}

export async function deletePreset(userId: string, name: string) {
    if (!supabase) return { success: false, message: 'DB未接続です。' };
    const { error } = await supabase.from('presets').delete().match({ user_id: userId, name });
    if (error) return { success: false, message: '削除に失敗しました。' };
    return { success: true, message: `🗑️ プリセット「**${name}**」を削除しました。` };
}

export async function saveProfileSetting(userId: string, key: string, value: string | null) {
    if (!supabase) return false;
    const presets = await getPresets(userId);
    const profile = presets.find((p: any) => p.name === '__profile__');
    const currentSettings = profile?.settings ?? {};
    if (value === null) delete currentSettings[key]; else currentSettings[key] = value;
    const { error } = await supabase.from('presets').upsert({ user_id: userId, name: '__profile__', settings: currentSettings }, { onConflict: 'user_id, name' });
    return !error;
}

export async function applyPenalty(userId: string, userName: string, type: string, reason: string) {
    if (!supabase) return { success: false, message: 'DB未接続です。' };
    if (type !== 'reset_rate') return { success: false, message: '不明なペナルティタイプです。' };
    const { error } = await supabase.from('users').upsert({ id: userId, name: userName, rate: 1500, streak: 0, updated_at: new Date().toISOString() }, { onConflict: 'id' });
    if (error) return { success: false, message: 'DBエラーが発生しました。' };
    return { success: true, message: `レートを初期値(${1500})に強制リセットしました` };
}

export async function resetSeasonAllUsers() {
    if (!supabase) return { topRate: [], topUser: null };

    try {
        const { data: seasonData } = await supabase
            .from('system_settings')
            .select('value')
            .eq('key', 'current_season')
            .single();
        
        const nextSeason = (seasonData?.value || 1) + 1;
        
        const { error: seasonUpdateError } = await supabase
            .from('system_settings')
            .upsert({ key: 'current_season', value: nextSeason });
            
        if (seasonUpdateError) {
            console.error('[resetSeasonAllUsers] シーズン更新エラー:', seasonUpdateError);
        } else {
            console.log(`[Season Reset] シーズン設定を Season ${nextSeason} に更新しました！`);
        }
    } catch (e) {
        console.error('[resetSeasonAllUsers] シーズン処理中にエラーが発生しました:', e);
    }

    const { data: topRateData } = await supabase.from('users').select('id, name, rate').order('rate', { ascending: false }).limit(3);
    const { data: allUsers } = await supabase.from('users').select('id');
    
    if (allUsers && allUsers.length > 0) {
        const now = new Date().toISOString();
        const resetRows = allUsers.map((u: any) => ({ id: u.id, rate: 1500, streak: 0, updated_at: now }));
        const { error } = await supabase.from('users').upsert(resetRows, { onConflict: 'id' });
        if (error) console.error('[resetSeasonAllUsers]', error);
        console.log(`[Season Reset] ${resetRows.length}人のレートをリセットしました。`);
    }
    
    return { topRate: topRateData ?? [], topUser: topRateData?.[0] ?? null };
}

const planCache = new Map<string, { plan: string, expires: number }>();
const CACHE_TTL = 1000 * 60 * 5;

export async function getUserPlan(userId: string): Promise<'free' | 'founder' | 'pro' | 'host' | 'supporter'> {
    const cached = planCache.get(userId);
    if (cached && cached.expires > Date.now()) {
        return cached.plan as 'free' | 'founder' | 'pro' | 'host' | 'supporter';
    }

    try {
        // @ts-ignore
        if (!supabase) return 'free';

        // @ts-ignore
        const { data, error } = await supabase
            .from('users')
            .select('plan')
            .eq('id', userId)
            .single();

        if (error || !data || !data.plan) {
            return 'free';
        }

        const plan = data.plan as 'free' | 'founder' | 'pro' | 'host' | 'supporter';
        planCache.set(userId, { plan, expires: Date.now() + CACHE_TTL });
        return plan;

    } catch (e) {
        console.error('DB Fetch Error (getUserPlan):', e);
        return 'free';
    }
}

export function clearUserPlanCache(userId: string) {
    planCache.delete(userId);
}
