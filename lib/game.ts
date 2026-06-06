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

export function calculateScore(
  team: Team,
  reports: Report[],
  durationMinutes: number,
  startedAt: number | null,
  finishedAt = Date.now(),
) {
  let score = arraysEqual(team.currentOrder, team.originalSentences) ? 35 : 0;
  if (team.selectedType === team.correctType) score += 25;

  if (reports.length) {
    const reasonPoints =
      reports.reduce(
        (sum, report) => sum + (report.reasonChoice === correctReason[team.correctType] ? 20 : 0),
        0,
      ) / reports.length;
    const explanationPoints =
      reports.reduce((sum, report) => sum + (report.explanation.trim().length >= 10 ? 10 : 0), 0) /
      reports.length;
    score += reasonPoints + explanationPoints;
  }

  if (startedAt) {
    const elapsed = Math.max(0, finishedAt - startedAt);
    const total = durationMinutes * 60_000;
    score += Math.max(0, Math.round(10 * (1 - elapsed / total)));
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
        report.explanation.trim().length >= 20,
    ).length >= Math.ceil(reports.length * 0.7);

  if ((team.score ?? 0) >= 90 || strongRound2) badges.push("논리 탐정단");
  if (
    arraysEqual(team.currentOrder, team.originalSentences) &&
    team.selectedType === team.correctType
  ) {
    badges.push("사건 복원 성공");
  }
  if (memberCount > 0 && reports.length >= Math.ceil(memberCount * 0.7)) {
    badges.push("협동 탐정단");
  }
  if (!team.hintSent) badges.push("자력 해결 탐정단");
  return badges.slice(0, 2);
}
