// src/admin.ts
import { EmbedBuilder } from 'discord.js';
import { getAllGames, getGame, hasGame } from './state';
import { GameState } from './types';

function buildLifeBar(alive: number, total: number): string {
    const max = Math.min(total, 15);
    let bar = '';
    for (let i = 0; i < max; i++) bar += i < alive ? '█' : '░';
    return `\`${bar}\` ${alive}/${total}名`;
}

export function buildGamesEmbed(client: any): EmbedBuilder {
    const allGames = getAllGames();
    const playing: string[] = [], recruiting: string[] = [];

    for (const [channelId, game] of allGames) {
        const ch = `<#${channelId}>`;
        const humanCount = game.players.filter(p => !p.isNpc).length;
        const npcCount   = game.players.filter(p => p.isNpc).length;
        const total      = game.players.length;
        const match      = game.settings?.matchType === 'ranked' ? '🏆' : '🔰';

        if (game.state === 'playing') {
            const alive = game.players.filter(p => p.alive).length;
            playing.push(`${ch}\n${buildLifeBar(alive, total)}\n　📅 **${game.dayCount}日目** | ${match} 人間${humanCount} NPC${npcCount}`);
        } else if (game.state === 'recruiting') {
            const filled = '▰'.repeat(Math.min(total, 15));
            const empty  = '▱'.repeat(Math.max(0, 4 - total));
            recruiting.push(`${ch}\n　\`${filled}${empty}\` ${total}名参加中（人間${humanCount} NPC${npcCount}）`);
        }
    }

    const totalActive = playing.length + recruiting.length;
    const embed = new EmbedBuilder()
        .setTitle('🗺️ 全サーバー ゲーム稼働状況')
        .setColor(totalActive === 0 ? 0x808080 : playing.length > 0 ? 0xFF4444 : 0xFFAA00)
        .setTimestamp()
        .setFooter({ text: 'Tomatobot Admin Panel | /sysinfo で詳細確認' });

    if (totalActive === 0) {
        embed.setDescription('現在、稼働中のゲームはありません。\n`!jinro` で新しい村を建てましょう！');
        return embed;
    }

    embed.setDescription(`🔴 **進行中**: ${playing.length}試合　　🟡 **募集中**: ${recruiting.length}試合\n📊 **アクティブ合計**: ${totalActive}試合`);
    if (playing.length)    embed.addFields({ name: `🔴 進行中 (${playing.length}試合)`,    value: playing.join('\n\n'),    inline: false });
    if (recruiting.length) embed.addFields({ name: `🟡 募集中 (${recruiting.length}試合)`, value: recruiting.join('\n\n'), inline: false });
    return embed;
}

export function kickPlayerFromLobby(channelId: string, targetUserId: string, executorId: string): { success: boolean; message: string } {
    if (!hasGame(channelId)) return { success: false, message: '⚠️ このチャンネルにはゲームが存在しません。' };
    const game = getGame(channelId);
    if (game.state !== 'recruiting') return { success: false, message: '⚠️ `/kick` は**募集中**のロビーでのみ使用できます。' };
    const idx = game.players.findIndex(p => p.id === targetUserId);
    if (idx === -1) return { success: false, message: '⚠️ 指定されたユーザーはこのロビーに参加していません。' };
    if (targetUserId === game.hostId) return { success: false, message: '⚠️ ホストをキックすることはできません。' };
    const target = game.players[idx];
    game.players.splice(idx, 1);
    return { success: true, message: `✅ **${target.name}** をロビーから退出させました。` };
}

export async function announceToAllGames(message: string, targetState: 'all' | 'playing' | 'recruiting' = 'all'): Promise<{ sent: number; failed: number }> {
    const allGames = getAllGames();
    let sent = 0, failed = 0;
    const embed = new EmbedBuilder().setTitle('📢 【運営からのお知らせ】').setDescription(message).setColor(0xFFAA00).setTimestamp();
    for (const [, game] of allGames) {
        if (!game.channel) continue;
        const ok = targetState === 'all' || (targetState === 'playing' && game.state === 'playing') || (targetState === 'recruiting' && game.state === 'recruiting');
        if (!ok) continue;
        try { await game.channel.send({ embeds: [embed] }); sent++; } catch { failed++; }
    }
    return { sent, failed };
}

export function forceSkipTimers(channelId: string): { success: boolean; message: string } {
    if (!hasGame(channelId)) return { success: false, message: '⚠️ このチャンネルにはゲームが存在しません。' };
    const game = getGame(channelId);
    if (game.state !== 'playing') return { success: false, message: '⚠️ ゲームが進行中ではありません。' };
    const tc = game.timers?.length ?? 0, cc = game.collectors?.length ?? 0;
    if (game.timers?.length) { game.timers.forEach(t => clearTimeout(t)); game.timers = []; }
    if (game.collectors?.length) { game.collectors.forEach(c => { try { c.stop(); } catch {} }); game.collectors = []; }
    return { success: true, message: `⏩ **フェーズスキップ実行。**\nタイマー ${tc}件 / コレクター ${cc}件 を強制停止しました。\n⚠️ フェーズが進まない場合は \`/reset\` を使用してください。` };
}

export function getGameStatusText(game: GameState): string {
    if (game.state === 'idle')       return '⚪ 待機中';
    if (game.state === 'recruiting') return `🟡 募集中 (${game.players.length}名参加中)`;
    if (game.state === 'playing') {
        const alive = game.players.filter(p => p.alive).length;
        return `🔴 進行中 ${game.dayCount}日目 (${alive}/${game.players.length}名生存)`;
    }
    return '不明';
}
