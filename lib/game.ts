import { ArgumentType, ParsedTeam, Report, Team } from "./types";

export const reasonOptions = {
  A: "일반 원리에서 개별 사례를 이끌어 냈다.",
  B: "여러 사례를 보고 일반 결론을 내렸다.",
  C: "비슷한 사례를 비교하였다.",
} as const;

export const correctReason: Record<ArgumentType, keyof typeof reasonOptions> = {
  연역: "A",
  귀납: "B",
  유추: "C",
};

export function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function parseTeamText(input: string): ParsedTeam[] {
  const blocks = input
    .split(/(?=\[\d+모둠\])/)
    .map((block) => block.trim())
    .filter(Boolean);

  return blocks.map((block) => {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    const header = lines.shift();
    const match = header?.match(/^\[(\d+)모둠\]$/);
    if (!match) throw new Error(`모둠 제목 형식을 확인하세요: ${header ?? "없음"}`);

    const typeLine = lines.pop();
    const argumentType = typeLine?.replace("#", "") as ArgumentType;
    if (!["연역", "귀납", "유추"].includes(argumentType)) {
      throw new Error(`${match[1]}모둠의 논증 방법을 #연역, #귀납, #유추 중 하나로 적어 주세요.`);
    }
    if (lines.length < 2) throw new Error(`${match[1]}모둠에는 문장이 2개 이상 필요합니다.`);

    return { number: Number(match[1]), sentences: lines, argumentType };
  });
}

export function arraysEqual(a: string[], b: string[]) {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

export function getFinalOrder(team: Team) {
  return team.finalOrder ?? team.currentOrder;
}

export function getFinalSelectedType(team: Team) {
  return team.finalSelectedType ?? team.selectedType;
}

const weakExplanationPatterns = [
  /^(ㅋ+|ㅎ+|ㅇ+|ㄴ+|ㅁ+)$/,
  /^(몰라요?|모름|그냥|아무거나|좋아요?|네|아니요|ㅇㅇ|ㄴㄴ)[.!?~ ]*$/,
  /(아무 말|대충|잘 모르겠|모르겠어요)/,
];

const methodKeywords: Record<ArgumentType, string[]> = {
  연역: ["연역", "일반 원리", "개별 사례", "전제", "필연", "이끌어"],
  귀납: ["귀납", "여러 사례", "관찰", "공통", "일반 결론", "일반화"],
  유추: ["유추", "비슷", "유사", "비교", "공통점", "닮은"],
};

const commonWords = new Set([
  "그리고",
  "그러나",
  "따라서",
  "때문",
  "문장",
  "사례",
  "결론",
  "일반",
  "개별",
  "여러",
  "방법",
]);

export function scoreExplanation(team: Team, report: Report) {
  const explanation = report.explanation.trim().replace(/\s+/g, " ");
  const compact = explanation.replace(/[\s.,!?~"'`()]/g, "");
  if (compact.length < 5 || weakExplanationPatterns.some((pattern) => pattern.test(explanation))) {
    return 0;
  }

  let score = compact.length >= 18 ? 2 : 1;
  const selectedMethod = getFinalSelectedType(team) ?? team.correctType;
  const relatedMethodWords = methodKeywords[selectedMethod];
  const mentionsMethod = relatedMethodWords.some((keyword) => explanation.includes(keyword));
  const mentionsOtherMethod = (Object.keys(methodKeywords) as ArgumentType[]).some(
    (method) =>
      method !== selectedMethod &&
      methodKeywords[method].some((keyword) => explanation.includes(keyword)),
  );
  if (mentionsMethod) score += 3;
  else if (mentionsOtherMethod) score += 1;

  const contentWords = team.originalSentences
    .join(" ")
    .match(/[가-힣A-Za-z0-9]{2,}/g)
    ?.filter((word) => !commonWords.has(word)) ?? [];
  const connectsToText =
    contentWords.some((word) => explanation.includes(word)) ||
    ["글에서", "문장에서", "첫 문장", "두 번째", "세 번째"].some((phrase) =>
      explanation.includes(phrase),
    );
  if (connectsToText) score += 2;

  const givesReason = ["때문", "이므로", "이어서", "따라서", "그래서", "판단", "결론"].some(
    (keyword) => explanation.includes(keyword),
  );
  if (givesReason) score += 2;

  if (compact.length >= 30 && mentionsMethod && (connectsToText || givesReason)) score += 1;
  return Math.min(10, score);
}

export function calculateScore(
  team: Team,
  reports: Report[],
  durationMinutes: number,
  startedAt: number | null,
) {
  let score = 0;

  if (team.round1SubmittedAt) {
    if (arraysEqual(getFinalOrder(team), team.originalSentences)) score += 35;
    if (getFinalSelectedType(team) === team.correctType) score += 25;

    if (startedAt) {
      const elapsed = Math.max(0, team.round1SubmittedAt - startedAt);
      const total = durationMinutes * 60_000;
      score += Math.max(0, Math.round(10 * (1 - elapsed / total)));
    }
  }

  if (reports.length) {
    const reasonPoints =
      reports.reduce(
        (sum, report) => sum + (report.reasonChoice === correctReason[team.correctType] ? 20 : 0),
        0,
      ) / reports.length;
    const explanationPoints =
      reports.reduce((sum, report) => sum + scoreExplanation(team, report), 0) /
      reports.length;
    score += reasonPoints + explanationPoints;
  }

  if (team.hintSent) score -= 5;
  return Math.max(0, Math.round(score));
}

export function calculateStudentScore(
  team: Team,
  report: Report | null | undefined,
  durationMinutes: number,
  startedAt: number | null,
) {
  let score = 0;

  if (team.round1SubmittedAt) {
    if (arraysEqual(getFinalOrder(team), team.originalSentences)) score += 35;
    if (getFinalSelectedType(team) === team.correctType) score += 25;

    if (startedAt) {
      const elapsed = Math.max(0, team.round1SubmittedAt - startedAt);
      const total = durationMinutes * 60_000;
      score += Math.max(0, Math.round(10 * (1 - elapsed / total)));
    }
  }

  if (report) {
    if (report.reasonChoice === correctReason[team.correctType]) score += 20;
    score += scoreExplanation(team, report);
  }

  if (team.hintSent) score -= 5;
  return Math.max(0, Math.round(score));
}

export function getBadges(team: Team, reports: Report[], memberCount = reports.length) {
  const badges: string[] = [];
  const strongRound2 =
    reports.length > 0 &&
    reports.filter(
      (report) =>
        report.reasonChoice === correctReason[team.correctType] &&
        scoreExplanation(team, report) >= 8,
    ).length >= Math.ceil(reports.length * 0.7);

  if ((team.score ?? 0) >= 90 || strongRound2) badges.push("논리 탐정단");
  if (
    arraysEqual(getFinalOrder(team), team.originalSentences) &&
    getFinalSelectedType(team) === team.correctType
  ) {
    badges.push("사건 복원 성공");
  }
  if (memberCount > 0 && reports.length >= Math.ceil(memberCount * 0.7)) {
    badges.push("협동 탐정단");
  }
  if (!team.hintSent) badges.push("자력 해결 탐정단");
  return badges.slice(0, 2);
}
