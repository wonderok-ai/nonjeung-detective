export type ArgumentType = "연역" | "귀납" | "유추";
export type GamePhase = "lobby" | "round1" | "round2" | "finished";

export type CharacterId =
  | "fox"
  | "owl"
  | "bear"
  | "rabbit"
  | "penguin"
  | "cat";

export interface Character {
  id: CharacterId;
  name: string;
  emoji: string;
  color: string;
}

export interface ClassRoom {
  id: string;
  name: string;
  code: string;
  durationMinutes: number;
  teamCount: number;
  phase: GamePhase;
  startedAt: number | null;
  createdAt: number;
}

export interface Team {
  id: string;
  name: string;
  originalSentences: string[];
  shuffledSentences: string[];
  currentOrder: string[];
  correctType: ArgumentType;
  selectedType: ArgumentType | null;
  hintRequested: boolean;
  hintSent: string | null;
  round1SubmittedAt: number | null;
  score: number | null;
}

export interface Member {
  id: string;
  name: string;
  characterId: CharacterId;
  teamId: string;
  joinedAt: number;
  online: boolean;
}

export interface Report {
  studentId: string;
  studentName: string;
  teamId?: string;
  reasonChoice: "A" | "B" | "C";
  explanation: string;
  submittedAt: number;
}

export interface ParsedTeam {
  number: number;
  sentences: string[];
  argumentType: ArgumentType;
}
