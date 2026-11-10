import { GoogleGenAI } from '@google/genai';
import { GameState, Player } from './types';
import * as Roles from './roles';

// 環境変数からAPIキーを取得
const disabledApiKey = (): string | undefined => undefined;
const apiKey = disabledApiKey();

// APIキーがある場合のみ、新しいSDKを初期化
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

const mvpComments: Record<string, string[]> = {
    normal: [
        "見事な活躍でした！{reason}が村を勝利へ導きましたね！",
        "素晴らしいプレイング！{reason}のおかげで勝利できました！",
        "まさにMVP級の働き！{reason}が決定打になりました！"
    ],
    toxic: [
        "は？{reason}程度でMVP？まぁ、運が良かっただけだろ。",
        "お前が勝てたのは{reason}というより、敵が自滅しただけだ。調子乗るなよ？",
        "MVPねぇ…。まぁ{reason}くらいはやって当然だけどな。次はもっとマシな試合を見せろよな。"
    ],
    passionate: [
        "熱い！熱すぎる！！{reason}が勝負を完全に決定づけましたぁぁぁ！！🔥",
        "eSports史に残る神プレイ！{reason}、まさに伝説の誕生だぁぁぁ！！🏆",
        "最高のエキサイトメント！！{reason}からの勝利、実況席も大興奮です！！🎙️🔥"
    ],
    logical: [
        "勝因分析: {reason}。極めて最適解に近いプレイングでした。",
        "ログ解析の結果、{reason}が勝利の決定的要因と推測されます。",
        "感情を排除して評価します。{reason}は論理的に一切の無駄がない行動でした。"
    ]
};

const summaryEvaluations: Record<string, string[]> = {
    normal: ["両陣営ともベストを尽くした、素晴らしい試合でした！", "最後まで読めない、ハラハラする展開でしたね！"],
    toxic: ["いやー、見ているこっちが恥ずかしくなるような泥仕合だったな。", "敗北した陣営は、今回の反省を次に活かしてくれよな。"],
    passionate: ["GG！！全員に拍手を送りたい、魂のぶつかり合いでした！！", "この熱戦、絶対に後世に語り継がれるべき神試合です！！"],
    logical: ["規定ターン数で終了。確率論に基づいた妥当な結末と言えます。", "行動ログの矛盾が勝敗を分けたポイントでした。"]
};

export function generateGameSummary(players: Player[], winnerTeam: string, tone: string = 'normal'): string {
    const rolesInfo = players.map(p => `- ${p.name}: ${p.role} (${p.alive ? '生存' : '💀死亡'})`).join('\n');
    const evaluationList = summaryEvaluations[tone] || summaryEvaluations['normal'];
    const randomEval = evaluationList[Math.floor(Math.random() * evaluationList.length)];

    return `🤖 **【システム戦況サマリー】**

📊 **試合データ**

* **勝利陣営:** 🎉 ${winnerTeam}
* **プレイヤーの最終生存状況:**
${rolesInfo}

💡 **システム総評**
${randomEval}`;
}

/**
 * 🏆 MVP寸評生成（性格反映・ログ分析強化版）
 */
export async function generateMvpComment(mvpData: { name: string, role: string, reason: string }, gameHistory: string[], tone: string = 'passionate'): Promise<string> {
    
    const getFallbackComment = () => {
        const commentList = mvpComments[tone] || mvpComments['passionate'];
        const template = commentList[Math.floor(Math.random() * commentList.length)];
        return template.replace('{reason}', mvpData.reason);
    };

    if (!ai) return getFallbackComment();

    try {
        const historyText = gameHistory.join('\n');

        // 性格に応じたペルソナを設定
        let personaPrompt = "";
        switch (tone) {
            case 'toxic': personaPrompt = "口が悪く、上から目線でプレイヤーを小馬鹿にする毒舌な解説者"; break;
            case 'logical': personaPrompt = "感情を完全に排除し、論理とデータのみで勝因を分析する冷徹なAIアナリスト"; break;
            case 'passionate': personaPrompt = "喉が枯れるほど絶叫する、超熱血eSports実況キャスター"; break;
            default: personaPrompt = "落ち着いたトーンで的確に試合を振り返る、プロのゲーム解説者"; break;
        }

        const prompt = `
あなたは人狼ゲームの「${personaPrompt}」です。
試合が終了し、MVPが決定しました。以下の【試合の全ログ】と【MVP情報】を読み込み、MVPの具体的な活躍を実況・解説してください。

【試合の全ログ（時系列）】
${historyText}

【MVP情報】
・プレイヤー名: ${mvpData.name}
・役職: ${mvpData.role}
・システム選出理由: ${mvpData.reason}

【厳格なルール】
1. ログから、MVP（${mvpData.name}）の「決定的な発言」「正確な占い・護衛」「見事な潜伏や騙り」など、具体的なアクションを1つ必ず抜き出して評価に組み込むこと。
2. キャラクター（${personaPrompt}）の口調を完璧に再現すること。
3. だらだらと長く話さず、Discordのチャットで読みやすい【150〜200文字程度】で、キレのあるコメントにまとめること。
4. 単なるシステムの選出理由をオウム返ししないこと。
        `;

        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt
        });

        return response.text ? response.text.trim() : getFallbackComment();

    } catch (e: any) {
        console.error("[SafeCatch] Gemini API Error (MVP):", e.message || e);
        return getFallbackComment();
    }
}

/**
 * 🐺 初夜ブリーフィング生成（AI軍師の知能向上版）
 */
export async function generateWolfBriefing(game: GameState, speakerName: string = "AI軍師", isNpc: boolean = false, personality: string = 'normal'): Promise<string> {
    
    const getFallbackBriefing = () => "（通信エラー：今夜は己の牙と直感だけを頼りにしなさい……）";
    
    if (!ai) return getFallbackBriefing();

    try {
        const wolves = game.players.filter(p => Roles.isActualWolf(p.role as string) || p.role === '分断者').map(p => p.name).join(', ');
        const rolesInGame = game.settings.roles.map(r => Roles.ROLE_MAP[r] || r).join(', ');

        let toneInstruction = "相棒に話しかけるような、不敵で頼もしいトーン";
        if (isNpc) {
            switch (personality) {
                case 'aggressive': toneInstruction = "血の気の多い、好戦的で野蛮な口調（「ぶっ殺そうぜ」「俺が噛みちぎる」等）"; break;
                case 'cautious': toneInstruction = "臆病で疑心暗鬼な口調（「バレないようにしようよ」「怖いな…」等）"; break;
                case 'logical': toneInstruction = "冷徹で機械的な口調（「確率は〜です」「〜が最適解だ」等）"; break;
                case 'witty': toneInstruction = "皮肉屋で余裕ぶった口調（「せいぜい足掻いてもらおうか」「愚かな村人どもだ」等）"; break;
                case 'joker': toneInstruction = "お調子者でトリッキーな口調（「ヒャッハー！」「やっちゃおうぜ〜！」等）"; break;
                case 'gal': toneInstruction = "テンションの高いギャル語（「マジウケるんだけど」「〜っしょ！」「とりま噛む？」等）"; break;
                case 'serious': toneInstruction = "軍人のように真面目で堅物な口調（「我々の使命は〜だ」「油断せず行こう」等）"; break;
            }
        }

        const prompt = isNpc ? `
あなたは人狼ゲームの参加者「${speakerName}」です。陣営は人狼側です。
1日目の夜、専用チャットで仲間のプレイヤーに向けて作戦を提案してください。

【状況】
・味方の陣営: ${wolves}
・この村に存在する役職: ${rolesInGame}

【厳格なルール】
1. 「俺が占い師を騙る」「俺は霊能に出る」「俺は身を潜める」など、自分（${speakerName}）の役回りを必ず1つ宣言すること。
2. 存在しない役職を語らないこと。必ず【この村に存在する役職】を利用した作戦を立てること。
3. 箇条書きは禁止。Discordのチャットらしい、生々しいセリフ（2〜3文）にすること。
4. 口調は、【${toneInstruction}】を厳守すること。
5. 【超重要】システムの都合上、文章の一番最後に、自分の行動を示す以下のタグを必ず1つだけ出力すること。
  ・占い騙りの場合: [SEER]
  ・霊能騙りの場合: [MEDIUM]
  ・潜伏の場合: [HIDE]
        ` : `
あなたは人狼陣営を勝利に導く「冷徹で邪悪な天才軍師」です。
1日目の夜、人狼たちへ向けて【高度な盤面操作と心理戦術】を指示してください。

【状況】
・味方の陣営: ${wolves}
・この村に存在する役職: ${rolesInGame}

【厳格なルール】
1. 役職のルール説明は一切不要。
2. 「どの役職を騙って場を荒らすか」「分断や死霊術など、存在する役職をどう逆利用するか」という、実用的で狡猾な戦術を1つ具体的に提案すること。
3. 箇条書きは禁止。短いセリフ（3文程度）として語ること。
4. 諸葛亮孔明のような、知的で静かなる狂気を孕んだ口調で語ること。
        `;

        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt
        });

        return response.text ? response.text.trim() : getFallbackBriefing();

    } catch (e: any) {
        console.error("[SafeCatch] Gemini API Error (Briefing):", e.message || e);
        return getFallbackBriefing();
    }
}
