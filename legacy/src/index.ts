// src/index.ts
import * as dns from 'dns';
dns.setDefaultResultOrder('ipv4first');
import * as http from 'http';
import {
    Client, GatewayIntentBits, Interaction,
    SlashCommandBuilder, TextChannel, PermissionFlagsBits,
    ActivityType
} from 'discord.js';

// 🟢 人狼用のインポートのみ
import * as GameLogic from './gameLogic';
import * as Messages from './messages';
import * as DB from './db';
import { getGame, hasGame, initGame, resetGame, findGameByUserId } from './state';
import * as dotenv from 'dotenv';
dotenv.config();
import * as Roles from './roles';
import { getPublicRankings, handleRankingButton, handleRankingCommand, isRankingButton } from '../../src/ranking';

const CHAT_LOG_MAX = 200;
const TIMELINE_MAX = 500;

const client = new Client({
    allowedMentions: { parse: [] },
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildVoiceStates, // 🎙️ 人狼のVCミュート管理などに必要
    ],
});

const port = process.env.PORT || 10000;
let startupReady = false;
http.createServer(async (req, res) => {
    if (req.url?.split('?')[0] === '/api/rankings') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            return res.end();
        }
        const result = req.method === 'GET' ? await getPublicRankings() : null;
        res.writeHead(!result ? 405 : result.status === 'found' ? 200 : 503, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
        });
        return res.end(JSON.stringify(result?.status === 'found' ? result.payload : {
            error: result ? 'rankings_unavailable' : 'method_not_allowed',
        }));
    }
    const ready = startupReady && client.isReady();
    res.writeHead(ready ? 200 : 503, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(ready ? 'JinroBot legacy 33011bd / rating b2c12fa ready' : 'JinroBot starting');
}).listen(port, () => console.log(`🌐 ヘルスチェックサーバーがポート ${port} で起動しました！`));

process.on('unhandledRejection', r => console.error('🚨 UnhandledRejection:', r));
process.on('uncaughtException',  e => console.error('🚨 UncaughtException:', e));

client.once('ready', async () => {
    console.log(`${client.user?.tag} Login Complete!`);
    client.user?.setActivity('🌑夜の村を監視中 | /jinro', { type: ActivityType.Playing });

    
    const commands = [
        new SlashCommandBuilder().setName('jinro').setDescription('人狼の募集ロビーを開始します'), // 🟢 追加
        new SlashCommandBuilder().setName('stats').setDescription('自分の戦績を表示します'), // 🟢 追加
        new SlashCommandBuilder().setName('ranking').setDescription('公開ランキングへの参加設定を変更します')
            .addSubcommand(s => s.setName('join').setDescription('公開ランキングに参加します'))
            .addSubcommand(s => s.setName('leave').setDescription('公開ランキングから退出します')),
        new SlashCommandBuilder().setName('reset').setDescription('現在のチャンネルのゲームを強制終了・リセットします').setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
        new SlashCommandBuilder().setName('preset').setDescription('主催向け：オリジナル村設定を保存・呼出します')
            .addSubcommand(s => s.setName('save').setDescription('現在の設定を保存').addStringOption(o => o.setName('name').setDescription('プリセット名').setRequired(true)))
            // ▼ ここに .setAutocomplete(true) を追加！
            .addSubcommand(s => s.setName('load').setDescription('設定を読み込む').addStringOption(o => o.setName('name').setDescription('プリセット名').setRequired(true).setAutocomplete(true)))
            .addSubcommand(s => s.setName('list').setDescription('プリセット一覧を表示'))
            // ▼ ここにも .setAutocomplete(true) を追加！
            .addSubcommand(s => s.setName('delete').setDescription('プリセットを削除').addStringOption(o => o.setName('name').setDescription('プリセット名').setRequired(true).setAutocomplete(true))),
    ];

    try {
        await DB.checkLegacyStorage();
        await client.application!.commands.set(commands);
        startupReady = true;
        console.log('[legacy 33011bd / rating b2c12fa] Discord commands and existing rating storage ready');
    } catch (error) {
        console.error('[legacy 33011bd] startup failed:', error);
    }
});
client.on('messageCreate', async (message) => {
    if (message.author.bot || message.content.startsWith('/')) return;
    const content = message.content.trim();
    if (message.guild) {
        const channel = message.channel as TextChannel;
        
        // 人狼のログ収集処理
        if (hasGame(message.channelId)) {
            const game = getGame(message.channelId);
            if (game.state === 'playing') {
                const player = game.players.find((p: any) => p.id === message.author.id);
                if (player?.alive) {
                    const name = message.member?.displayName || message.author.username;
                    if (!game.chatLog) game.chatLog = [];
                    game.chatLog.push({ id: message.author.id, name, content: message.content, day: game.dayCount });
                    if (game.chatLog.length > CHAT_LOG_MAX) game.chatLog.shift();
                    if (!game.timeline) game.timeline = [];
                    game.timeline.push({ type: 'chat', day: game.dayCount, id: message.author.id, name, content: message.content });
                    if (game.timeline.length > TIMELINE_MAX) game.timeline.shift();
                }
            }
        }
    }
});

client.on('interactionCreate', async (interaction: Interaction) => {
    // ▼▼ ここから追加 ▼▼
    if (interaction.isAutocomplete()) {
        if (interaction.commandName === 'preset') {
            try {
                const focusedValue = interaction.options.getFocused() || '';
                
                // DBから取得（ここで3秒以上かかるとDiscord側にタイムアウトされます）
                const presets = (await DB.getPresets(interaction.user.id)) || [];
                const choices = presets.map((p: any) => p.name || '名称未設定');
                
                const filtered = choices
                    .filter((choice: string) => choice.toLowerCase().includes(focusedValue.toLowerCase()))
                    .slice(0, 25);
                
                // 既にタイムアウトなどでレスポンス済み扱いになっていないかチェック
                if (!interaction.responded) {
                    await interaction.respond(
                        filtered.map((choice: string) => ({ name: choice, value: choice }))
                    );
                }
            } catch (error: any) {
                // Discordの「時間切れ(10062)」や「レスポンス重複(40060)」エラーは仕様上避けられないことがあるため無視する
                if (error.code === 10062 || error.code === 40060) return;
                
                console.error('プリセットのサジェストで予期せぬエラー:', error);
                
                if (!interaction.responded) {
                    await interaction.respond([]).catch(() => {});
                }
            }
        }
        return;
    }
    // ▲▲ ここまで追加 ▲▲

    // ── スラッシュコマンド ──
    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'ranking') {
            await handleRankingCommand(interaction);
            return;
        }
        if (!interaction.inGuild() || !interaction.channel?.isTextBased()) return;
        const channel = interaction.channel as TextChannel;
        try {
            switch (interaction.commandName) {
                // 🟢 追加: /jinro コマンドの処理
                case 'jinro': {
                    const game = getGame(channel.id);
                    if (game?.state === 'playing') { 
                        await interaction.reply({ content: '⚠️ ゲーム進行中です。リセットコマンドを使うか、終了をお待ちください。', ephemeral: true }); 
                        return; 
                    }
                    const existing = findGameByUserId(interaction.user.id);
                    if (existing && existing.channel?.id !== channel.id) { 
                        await interaction.reply({ content: `⚠️ あなたは既に別の村（<#${existing.channel?.id}>）に参加しているため、新しく村を建てることはできません。`, ephemeral: true }); 
                        return; 
                    }
                    
                    initGame(channel, interaction.user);
                    const newGame = getGame(channel.id);
                    
                    // ペイロードを取得して、interaction.replyとして送信し、そのメッセージオブジェクトをlobbyMessageに保存します
                    const payload = await Messages.getLobbyPayload(newGame, interaction.user.id, interaction.member as any);
                    newGame.lobbyMessage = await interaction.reply({ ...payload, fetchReply: true });
                    return;
                }

                // 🟢 追加: /stats コマンドの処理
                case 'stats': {
                    // 処理に時間がかかる可能性があるため、一旦deferReplyを挟みます
                    await interaction.deferReply({ ephemeral: true });
                    await GameLogic.showStats(interaction.user.id, { 
                        user: interaction.user, 
                        editReply: async (d: any) => interaction.editReply(d) 
                    });
                    return;
                }

                case 'reset': {
                    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
                        return interaction.reply({ content: 'この操作にはメッセージの管理権限が必要です。', ephemeral: true });
                    }
                    if (!hasGame(channel.id)) return interaction.reply({ content: '⚠️ このチャンネルでゲームは進行していません。', ephemeral: true });
                    resetGame(channel.id, true); await interaction.reply({ content: '🔄 **ゲームを強制リセットしました。**' }); return;
                }
                case 'preset': {
                    const subCmd = interaction.options.getSubcommand();
                    
                    // 🌟 3秒タイムアウト回避のために「考え中...」にする
                    await interaction.deferReply({ ephemeral: true });

                    try {
                        if (subCmd === 'load') {
                            const presetName = interaction.options.getString('name')!;
                            const presets = await DB.getPresets(interaction.user.id);
                            const found = presets.find((p: any) => p.name === presetName);

                            if (!found) {
                                return await interaction.editReply({ content: `❌ プリセット「${presetName}」が見つかりません。` });
                            }

                            const game = getGame(channel.id);
                            if (game.state === 'playing') {
                                return await interaction.editReply({ content: '⚠️ ゲーム進行中はプリセットを読み込めません。' });
                            }

                            // 設定をコピーして適用
                            game.settings = { ...found.settings, roles: [...(found.settings.roles || [])] };
                            
                            // 募集画面（ロビー）が出ている場合は表示を更新する
                            if (game.lobbyMessage) {
                                await game.lobbyMessage.edit(await Messages.getLobbyPayload(game, game.hostId, interaction.member as any)).catch(() => {});
                            }
                            
                            return await interaction.editReply({ content: `✅ プリセット「**${presetName}**」を読み込みました！\n（募集画面にも反映されました）` });
                        }
                        
                        if (subCmd === 'save') {
                            const presetName = interaction.options.getString('name')!;
                            const game = getGame(channel.id);
                            
                            // db.tsのsavePresetを呼び出す
                            const res = await DB.savePreset(interaction.user.id, presetName, game.settings, interaction.user.username);
                            return await interaction.editReply({ content: res.message });
                        }

                        if (subCmd === 'delete') {
                            const presetName = interaction.options.getString('name')!;
                            
                            // db.tsのdeletePresetを呼び出す
                            const res = await DB.deletePreset(interaction.user.id, presetName);
                            return await interaction.editReply({ content: res.message });
                        }

                        if (subCmd === 'list') {
                            const presets = await DB.getPresets(interaction.user.id);
                            if (!presets || presets.length === 0) {
                                return await interaction.editReply({ content: '保存されているプリセットはありません。' });
                            }
                            
                            const listStr = presets.map((p:any) => {
                                const roles = p.settings.roles?.map((r: string) => Roles.getShortRoleName(r)).join(' / ') || 'なし';
                                return `▪ **${p.name}**\n　└ 役職: ${roles}`;
                            }).join('\n\n');
                            
                            return await interaction.editReply({ content: `📦 **あなたの保存済みプリセット**\n\n${listStr}` });
                        }

                    } catch (error) {
                        console.error('プリセットコマンド実行エラー:', error);
                        await interaction.editReply({ content: '❌ 処理中にエラーが発生しました。' }).catch(()=>{});
                    }
                    return;
                }
            }
        } catch (e: any) {
            console.error('Command Error:', e);
            const msg = `⚠️ **エラーが発生しました**: ${e.message}`;
            if (interaction.replied || interaction.deferred) { await interaction.followUp({ content: msg, ephemeral: true }).catch(() => {}); } 
            else { await interaction.reply({ content: msg, ephemeral: true }).catch(() => {}); }
        }
    }

    if (interaction.isButton() && isRankingButton(interaction.customId)) {
        await handleRankingButton(interaction);
        return;
    }
    if (interaction.isButton() && interaction.customId.startsWith('verify_role_')) {
        await interaction.reply({ content: 'この認証ボタンは現在使用できません。', ephemeral: true }).catch(() => {});
        return;
    }

    // ── 人狼の関所処理（ボタン、セレクトメニュー、モーダル） ──
    if (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit()) {
        const gameExists = hasGame(interaction.channelId!) || !!findGameByUserId(interaction.user.id);
        if (!gameExists) {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: '⚠️ 参加中のゲームが見つかりません。（Bot再起動により無効になった可能性があります）',
                    ephemeral: true,
                }).catch(() => {});
            }
            return;
        }
        
        // 全てのアクションをGameLogic（人狼の処理）へ丸投げ
        await GameLogic.handleInteraction(interaction).catch(e => console.error('Interaction Error:', e.message));
    }
});

console.log("🚀 ボットを起動中...");
client.login(process.env.DISCORD_TOKEN).catch(console.error);
