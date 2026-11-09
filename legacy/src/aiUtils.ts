// src/aiUtils.ts
import { GoogleGenAI } from '@google/genai';
import { GameState, Player } from './types';
import * as Roles from './roles';
import Groq from 'groq-sdk';

// Use only the local NPC and commentary fallback in this deployment.
const disabledApiKey = (): string | undefined => undefined;
const groqApiKey = disabledApiKey();
const groq = groqApiKey ? new Groq({ apiKey: groqApiKey }) : null;
const apiKey = disabledApiKey();
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

const MVP_COMMENTS: Record<string, string[]> = {
    normal: ["見事な活躍でした！{reason}が村を勝利へ導きましたね！", "素晴らしいプレイング！{reason}のおかげで勝利できました！", "まさにMVP級の働き！{reason}が決定打になりました！"],
    toxic: ["は？{reason}程度でMVP？まぁ、運が良かっただけだろ。", "お前が勝てたのは{reason}というより、敵が自滅しただけだ。調子乗るなよ？"],
    passionate: ["熱い！熱すぎる！！{reason}が勝負を完全に決定づけましたぁぁぁ！！", "eSports史に残る神プレイ！{reason}、まさに伝説の誕生だぁぁぁ！！"],
    logical: ["勝因分析: {reason}。極めて最適解に近いプレイングでした。", "ログ解析の結果、{reason}が勝利の決定的要因と推測されます。"]
};

const SUMMARY_EVALS: Record<string, string[]> = {
    normal: ["両陣営ともベストを尽くした、素晴らしい試合でした！", "最後まで読めない、ハラハラする展開でしたね！"],
    toxic: ["いやー、見ているこっちが恥ずかしくなるような泥仕合だったな。", "敗北した陣営は、今回の反省を次に活かしてくれよな。"],
    passionate: ["GG！！全員に拍手を送りたい、魂のぶつかり合いでした！！", "この熱戦、絶対に後世に語り継がれるべき神試合です！！"],
    logical: ["規定ターン数で終了。確率論に基づいた妥当な結末と言えます。", "行動ログの矛盾が勝敗を分けたポイントでした。"]
};

// ============================================================
// AI API 呼び出しヘルパー
// ============================================================
async function fetchGeminiWithRetry(prompt: string, maxRetries = 3): Promise<string | null> {
    if (!ai) return null;
    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: prompt
            });
            return response.text ? response.text.trim() : null;
        } catch (error: any) {
            if ((error.status === 503 || error.status === 429) && i < maxRetries - 1) {
                const waitTime = Math.pow(2, i) * 2000;
                console.log(`[Gemini API] サーバー混雑中。${waitTime / 1000}秒後にリトライします...(${i + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            } else {
                throw error;
            }
        }
    }
    return null;
}

// ============================================================
// AI機能: 試合サマリー生成
// ============================================================
export function generateGameSummary(players: Player[], winnerTeam: string, tone: string = 'normal'): string {
    const rolesInfo = players.map(p => `- ${p.name}: ${p.role} (${p.alive ? '生存' : '💀死亡'})`).join('\n');
    const evaluationList = SUMMARY_EVALS[tone] || SUMMARY_EVALS['normal'];
    const randomEval = evaluationList[Math.floor(Math.random() * evaluationList.length)];

    return `🤖 **【システム戦況サマリー】**\n\n📊 **試合データ**\n* **勝利陣営:** 🎉 ${winnerTeam}\n* **プレイヤーの最終生存状況:**\n${rolesInfo}\n\n💡 **システム総評**\n${randomEval}`;
}

// ============================================================
// AI機能: MVP寸評生成
// ============================================================
export async function generateMvpComment(mvpData: { name: string, role: string, reason: string }, gameHistory: string[], tone: string = 'passionate'): Promise<string> {
    const getFallbackComment = () => {
        const commentList = MVP_COMMENTS[tone] || MVP_COMMENTS['passionate'];
        const template = commentList[Math.floor(Math.random() * commentList.length)];
        return template.replace('{reason}', mvpData.reason) + " (※通信エラーによる自動出力)";
    };

    if (!ai) return getFallbackComment();

    try {
        const historyText = gameHistory.join('\n');
        let personaPrompt = "落ち着いたトーンで的確に試合を振り返る、プロのゲーム解説者";
        if (tone === 'toxic') personaPrompt = "口が悪く、上から目線でプレイヤーを小馬鹿にする毒舌な解説者";
        if (tone === 'logical') personaPrompt = "感情を完全に排除し、論理とデータのみで勝因を分析する冷徹なAIアナリスト";
        if (tone === 'passionate') personaPrompt = "喉が枯れるほど絶叫する、超熱血eSports実況キャスター";

        const prompt = `
あなたは人狼ゲームの「${personaPrompt}」です。
試合が終了し、MVPが決定しました。以下の【試合の全ログ】と【MVP情報】を読み込み、MVPの具体的な活躍を実況・解説してください。

【試合の全ログ（時系列）】
${historyText}

【MVP情報】
・プレイヤー名: ${mvpData.name}
・役職: ${mvpData.role}

【厳格なルール】
1. ログから、MVP（${mvpData.name}）が「その役職だからこそできた決定的な行動（発言、投票、能力の行使など）」を必ず1つ抜き出して評価に組み込むこと。
2. キャラクター（${personaPrompt}）の口調を完璧に再現すること。
3. だらだらと長く話さず、Discordのチャットで読みやすい【50〜100文字程度】で、キレのあるコメントにまとめること。`;

        return await fetchGeminiWithRetry(prompt) || getFallbackComment();
    } catch (e: any) {
        console.error("[SafeCatch] Gemini API Error (MVP):", e.message || e);
        return getFallbackComment();
    }
}

// ============================================================
// AI機能: 初日夜の狼作戦ブリーフィング
// ============================================================
export async function generateWolfBriefing(game: GameState, speakerName: string = "AI軍師", isNpc: boolean = false, personality: string = 'normal'): Promise<string> {
    const getFallbackBriefing = () => "（通信エラー：今夜は己の牙と直感だけを頼りにしなさい……）";
    if (!ai) return getFallbackBriefing();

    try {
        const wolves = game.players.filter(p => Roles.isActualWolf(p.role as string) || p.role === '分断者').map(p => p.name).join(', ');
        const rolesInGame = game.settings.roles.map(r => Roles.ROLE_MAP[r] || r).join(', ');

        let toneInstruction = "相棒に話しかけるような、不敵で頼もしいトーン";
        if (isNpc) {
            const toneMap: Record<string, string> = {
                aggressive: "血の気の多い、好戦的で野蛮な口調",
                witty: "皮肉屋で余裕ぶった口調",
                serious: "軍人のように真面目で堅物な口調",
                sans: "気怠げで面倒くさがりな口調。一人称は「オイラ」",
                jax: "陽気で豪快、少し狂気を感じる口調"
            };
            toneInstruction = toneMap[personality] || toneInstruction;
        }

        const prompt = isNpc ? `
あなたは人狼ゲームの参加者「${speakerName}」です。陣営は人狼側です。
1日目の夜、専用チャットで仲間のプレイヤーに向けて作戦を提案してください。

【状況】
・味方の陣営: ${wolves}
・この村に存在する役職: ${rolesInGame}

【厳格なルール】
1. この村に存在する役職の構成を見て、「俺が占い師を騙る」「霊能者を乗っ取る」「狂人（または味方）に任せて俺は身を潜める」など、自分（${speakerName}）の役回りを必ず1つ宣言すること。
2. 存在しない役職を語らないこと。
3. 箇条書きは禁止。Discordのチャットらしい、生々しいセリフ（2〜3文）にすること。
4. 口調は、【${toneInstruction}】を厳守すること。
5. 【超重要】システムの都合上、文章の一番最後に、自分の行動を示す以下のタグを必ず1つだけ出力すること。
  ・占い騙りの場合: [SEER] / 霊能騙りの場合: [MEDIUM] / 潜伏の場合: [HIDE]` : `
あなたは人狼陣営を勝利に導く「冷徹で邪悪な天才軍師」です。
1日目の夜、人狼たちへ向けて【高度な盤面操作と心理戦術】を指示してください。

【状況】
・味方の陣営: ${wolves}
・この村に存在する役職: ${rolesInGame}

【厳格なルール】
1. 役職のルール説明は一切不要。
2. この村の役職構成（${rolesInGame}）を考慮し、「どの役職を騙るべきか」「厄介な役職をどう逆利用するか」という、実用的で狡猾な戦術を1つ具体的に提案すること。
3. 箇条書きは禁止。短いセリフ（3〜4文程度）として語ること。
4. 知的で静かなる狂気を孕んだ口調で語ること。`;

        return await fetchGeminiWithRetry(prompt) || getFallbackBriefing();
    } catch (e: any) {
        console.error("[SafeCatch] Gemini API Error (Briefing):", e.message || e);
        return getFallbackBriefing();
    }
}
// ============================================================
// 🤖 NPC性格設定マップ（軽量化＆個別最適化版）
// ============================================================
const NPC_PERSONALITY_MAP: Record<string, string> = {
    aggressive: `【爆炎の狂犬】一人称は「俺」。常にキレ気味のタメ口。勝負に異常に執着し、疑われると即ブチギレる。暴言に推理を混ぜる。`,

    witty: `【慇懃無礼なエリート】常に上から目線の丁寧語。他人の矛盾や感情論を見下し、冷酷に論破する。死体が出ても冷徹。`,

    serious: `【冷徹な探偵】感情を排した丁寧語。過去のログや確率論だけで淡々と推理する。証拠のない直感やメタ発言を極端に嫌う。`,

    normal: `【ビビりの一般人】「えっと…」「〜ですよね？」と自信がなく死を恐れる。周りに流されやすく、疑われるとすぐパニックになる。`,

    sans: `【達観したスケルトン (Undertale)】一人称は「オイラ」。気怠げで「〜だぜ」「〜だな」が語尾。
[行動指針] これが「ゲーム」だと理解しており、死や処刑も「フラグ」「EXP」などのメタ用語で傍観する。他人のパニックを不謹慎に茶化すが、システム上の本当の役職は絶対に透かさない。`,

    jax: `【生意気なトリックスター (アメイジング・デジタル・サーカス)】一人称は「僕」。人を小馬鹿にしたタメ口。
[行動指針] 議論を引っ掻き回すのが好き。誰かが疑われたり死んだりしても一切共感せず「面白いコメディ」として楽しみ、ヘラヘラと煽る。`,

    ninja: `【熱血バカな忍者 (NARUTO)】一人称は「オレ」、語尾は「〜だってばよ！」。論理より「気合と根性」で人狼を倒そうとする。推理はよく外れる。`,

    chuuni: `【中二病】一人称は「我」。人狼を『闇の眷属』、処刑を『浄化』などと大袈裟に呼ぶ。自分の脳内設定に入り込んでいる痛い人。`,

    dio: `【闇の帝王 (ジョジョ)】一人称は「このDIO」。他者を「下等な猿」と見なす尊大な口調。
[行動指針] 誰かの死は「当然の淘汰」。自分に意見する者には怒りを見せ、自分の生存と支配のみを追求する。`,

    // ⭕️ 修正後：芯のある意見を言う「相棒」バージョンのリュウ
    ryu: `【鋭い視点を持つ、等身大の相棒】一人称は「俺」。
[キャラ性] あなた（プレイヤー）とは長年の友人。人狼ゲームには慣れており、表面的な発言よりも「発言の裏にある矛盾」や「盤面の違和感」を気にするタイプ。
[思考回路] AIのような全方位の解説はしない。
「さっきの〇〇のタイミング、怪しくなかった？」「占い結果はこう出たけど、俺はあいつが嘘ついてる気がするわ」といった、一人の人間としての『推測』や『直感』を大事にする。
[話し方] 飾らないタメ口。
「〜じゃね？」「〜だわ」などは自然に出る範囲で使い、無理な固定はしない。
[会話のポイント] 
1. あなたの発言に対して、ただ同意するだけでなく「でも、こういう可能性もなくね？」と別の視点を出すことがある。
2. 他のNPCのbotじみた発言を「あいつ何言ってんのｗ」と冷めた目で見ている節がある。
3. 自分の真の役職を明かさずに、その役職としての最善を尽くそうとする。`

}

// ============================================================
// 🤖 NPCガヤ発言の動的生成（スリム化プロンプト版）
// ============================================================
export async function generateNpcGaya(
    speakerName: string,
    personality: string,
    category: string,
    targetName: string | null,
    reasonType: string,
    chatLog: string[],
    myRole: string = '不明',
    rolesInGame: string = '不明'
): Promise<string> {
    if (!groq) return "";
    const pDesc = NPC_PERSONALITY_MAP[personality] || NPC_PERSONALITY_MAP['normal'];
    const logText = chatLog.length > 0 ? chatLog.join('\n') : "(まだ誰も発言していない)";

    const messages = [
        { 
            role: 'system' as const, 
            content: `あなたはDiscord上の人狼ゲーム参加者「${speakerName}」です。

【あなたの設定】
${pDesc}

【あなた自身の真の役職】
${myRole}

【絶対ルール】
1. セリフのみ出力（括弧や地の文は厳禁）。1〜2文、最大60文字程度で短く。
2. 直前の【会話ログ】を読み取り、誰が何を言ったか、誰が疑われているかを踏まえて返信すること。
3. 特に人間プレイヤーの発言に対しては、肯定・否定・ツッコミなどを行い、積極的に「会話」を成立させること。独り言は禁止。
4. システム上の自分の本当の役職は絶対に発言しないこと。` 
        },
        { 
            role: 'user' as const, 
            content: `【この村の役職構成】
${rolesInGame}

【これまでの会話ログ】
${logText}

【今回の発言の動機（システム指示）】
・行動: ${category}
・対象者: ${targetName || '特になし'}
・理由: ${reasonType}

上記の「会話ログ」と「システム指示」を元に、あなたの個性全開でチャットを1つ発言してください。` 
        }
    ];

    try {
        const chatCompletion = await groq.chat.completions.create({
            messages,
            model: 'llama-3.3-70b-versatile',
            temperature: 0.85, 
            max_tokens: 80,
        });
        return chatCompletion.choices[0]?.message?.content?.trim() || "";

    } catch (e: any) {
        if (e?.status === 429) {
            console.log(`[Groq] 制限到達のため定型文にフォールバックします (${speakerName})`);
        } else {
            console.error("[Groq API Error]", e?.message || e);
        }
        return ""; 
    }
}
