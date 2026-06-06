"use client";

import {
  addDoc,
  collection,
  doc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import {
  BookOpenCheck,
  ChevronRight,
  Clock3,
  GripVertical,
  Lightbulb,
  LogIn,
  Play,
  RotateCcw,
  Send,
  ShieldCheck,
  Sparkles,
  Trophy,
  Users,
} from "lucide-react";
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  classCodeExists,
  db,
  ensureAnonymousUser,
  findClassByCode,
  firebaseEnabled,
  missingFirebaseEnv,
  refs,
} from "@/lib/firebase";
import {
  arraysEqual,
  calculateScore,
  correctReason,
  getBadges,
  parseTeamText,
  reasonOptions,
  shuffle,
} from "@/lib/game";
import {
  ArgumentType,
  Character,
  CharacterId,
  ClassRoom,
  GamePhase,
  Member,
  Report,
  Team,
} from "@/lib/types";

const characters: Character[] = [
  { id: "fox", name: "단서 여우", emoji: "🦊", color: "#ff9b6a" },
  { id: "owl", name: "추리 부엉이", emoji: "🦉", color: "#a98ee8" },
  { id: "bear", name: "형사 곰", emoji: "🐻", color: "#d69a6b" },
  { id: "rabbit", name: "탐정 토끼", emoji: "🐰", color: "#ff9dbc" },
  { id: "penguin", name: "분석 펭귄", emoji: "🐧", color: "#78b7e8" },
  { id: "cat", name: "기록 고양이", emoji: "🐱", color: "#f0c35a" },
];

const sampleInput = `[1모둠]
모든 포유류는 숨을 쉰다.
고래는 포유류이다.
따라서 고래는 숨을 쉰다.
#연역

[2모둠]
지난 월요일에 본 백조는 흰색이었다.
오늘 본 백조도 흰색이었다.
따라서 백조는 대체로 흰색일 것이다.
#귀납

[3모둠]
지구와 화성은 모두 태양 주위를 돈다.
지구에는 계절 변화가 있다.
따라서 화성에도 계절 변화가 있을 것이다.
#유추`;

const demoClass: ClassRoom = {
  id: "demo",
  name: "2학년 3반 국어",
  code: "LOGIC6",
  durationMinutes: 20,
  teamCount: 3,
  phase: "round1",
  startedAt: Date.now(),
  createdAt: Date.now(),
};

const parsedDemo = parseTeamText(sampleInput);
const demoTeams: Team[] = parsedDemo.map((item) => {
  const shuffled = shuffle(item.sentences);
  return {
    id: `team-${item.number}`,
    name: `${item.number}모둠`,
    originalSentences: item.sentences,
    shuffledSentences: shuffled,
    currentOrder: shuffled,
    correctType: item.argumentType,
    selectedType: null,
    hintRequested: false,
    hintSent: null,
    round1SubmittedAt: null,
    score: null,
  };
});

type View = "home" | "teacher-create" | "teacher" | "student-join" | "student";

function SortableCard({ id, index }: { id: string; index: number }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.65 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="sentence-card">
      <span className="card-number">{index + 1}</span>
      <p>{id}</p>
      <button className="drag-handle" {...attributes} {...listeners} aria-label="문장 이동">
        <GripVertical size={30} />
      </button>
    </div>
  );
}

export default function Home() {
  const [view, setView] = useState<View>("home");
  const [room, setRoom] = useState<ClassRoom | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [student, setStudent] = useState<Member | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const selectedTeam = teams.find((team) => team.id === student?.teamId) ?? null;

  useEffect(() => {
    if (!firebaseEnabled || !room?.id || room.id === "demo") return;
    const unsubRoom = onSnapshot(
      refs.class(room.id),
      (snap) => {
        if (snap.exists()) setRoom({ id: snap.id, ...snap.data() } as ClassRoom);
      },
      () => setNotice("수업 정보를 실시간으로 불러오지 못했습니다. Firebase 규칙을 확인해 주세요."),
    );
    const unsubTeams = onSnapshot(
      refs.teams(room.id),
      (snap) => {
        setTeams(snap.docs.map((item) => ({ id: item.id, ...item.data() }) as Team));
      },
      () => setNotice("모둠 정보를 실시간으로 불러오지 못했습니다. Firebase 연결을 확인해 주세요."),
    );
    return () => {
      unsubRoom();
      unsubTeams();
    };
  }, [room?.id]);

  useEffect(() => {
    if (!firebaseEnabled || !room?.id || room.id === "demo") return;
    const unsubs = teams.map((team) => {
      const unsubMembers = onSnapshot(
        refs.members(room.id, team.id),
        (snap) => {
          const incoming = snap.docs.map((item) => ({ id: item.id, ...item.data() }) as Member);
          setMembers((current) => [
            ...current.filter((member) => member.teamId !== team.id),
            ...incoming,
          ]);
        },
        () => setNotice(`${team.name} 학생 목록을 동기화하지 못했습니다.`),
      );
      const unsubReports = onSnapshot(
        refs.reports(room.id, team.id),
        (snap) => {
          const incoming = snap.docs.map(
            (item) => ({ ...item.data(), teamId: team.id }) as Report,
          );
          setReports((current) => [
            ...current.filter((report) => report.teamId !== team.id),
            ...incoming,
          ]);
        },
        () => setNotice(`${team.name} ROUND 2 보고서를 동기화하지 못했습니다.`),
      );
      return () => {
        unsubMembers();
        unsubReports();
      };
    });
    return () => unsubs.forEach((unsub) => unsub());
  }, [room?.id, teams.map((team) => team.id).join(",")]);

  function enterDemo(target: "teacher" | "student") {
    setRoom(demoClass);
    setTeams(demoTeams);
    setView(target === "teacher" ? "teacher" : "student-join");
    setNotice("Firebase 환경변수가 없어 데모 모드로 실행 중입니다.");
  }

  async function patchRoom(patch: Partial<ClassRoom>) {
    if (!room) return;
    setRoom({ ...room, ...patch });
    if (firebaseEnabled && room.id !== "demo") await updateDoc(refs.class(room.id), patch);
  }

  async function patchTeam(teamId: string, patch: Partial<Team>) {
    setTeams((current) =>
      current.map((team) => (team.id === teamId ? { ...team, ...patch } : team)),
    );
    if (firebaseEnabled && room?.id !== "demo") await updateDoc(refs.team(room!.id, teamId), patch);
  }

  async function createClass(form: {
    name: string;
    code: string;
    duration: number;
    teamCount: number;
    teamText: string;
  }) {
    setBusy(true);
    setNotice("");
    try {
      const parsed = parseTeamText(form.teamText);
      if (parsed.length !== form.teamCount) {
        throw new Error(`모둠 수는 ${form.teamCount}개인데 입력된 글은 ${parsed.length}개입니다.`);
      }
      if (!firebaseEnabled || !db) {
        const localTeams = parsed.map((item) => {
          const shuffled = shuffle(item.sentences);
          return {
            id: `team-${item.number}`,
            name: `${item.number}모둠`,
            originalSentences: item.sentences,
            shuffledSentences: shuffled,
            currentOrder: shuffled,
            correctType: item.argumentType,
            selectedType: null,
            hintRequested: false,
            hintSent: null,
            round1SubmittedAt: null,
            score: null,
          } satisfies Team;
        });
        setRoom({
          id: "demo",
          name: form.name,
          code: form.code.toUpperCase(),
          durationMinutes: form.duration,
          teamCount: form.teamCount,
          phase: "lobby",
          startedAt: null,
          createdAt: Date.now(),
        });
        setTeams(localTeams);
        setView("teacher");
        setNotice("데모 모드로 수업을 만들었습니다. Firebase 설정 후에는 모든 기기에서 동기화됩니다.");
        return;
      }

      const firestore = db;
      await ensureAnonymousUser();
      if (await classCodeExists(form.code)) {
        throw new Error("이미 사용 중인 입장 코드입니다. 다른 코드를 입력해 주세요.");
      }
      const roomRef = await addDoc(collection(firestore, "classes"), {
        name: form.name,
        code: form.code.toUpperCase(),
        durationMinutes: form.duration,
        teamCount: form.teamCount,
        phase: "lobby",
        startedAt: null,
        createdAt: Date.now(),
      });
      const batch = writeBatch(firestore);
      parsed.forEach((item) => {
        const shuffled = shuffle(item.sentences);
        batch.set(doc(firestore, "classes", roomRef.id, "teams", `team-${item.number}`), {
          name: `${item.number}모둠`,
          originalSentences: item.sentences,
          shuffledSentences: shuffled,
          currentOrder: shuffled,
          correctType: item.argumentType,
          selectedType: null,
          hintRequested: false,
          hintSent: null,
          round1SubmittedAt: null,
          score: null,
        });
      });
      await batch.commit();
      setRoom({
        id: roomRef.id,
        name: form.name,
        code: form.code.toUpperCase(),
        durationMinutes: form.duration,
        teamCount: form.teamCount,
        phase: "lobby",
        startedAt: null,
        createdAt: Date.now(),
      });
      setView("teacher");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "수업 생성에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function joinClass(info: {
    code: string;
    name: string;
    characterId: CharacterId;
    teamId: string;
  }) {
    setBusy(true);
    setNotice("");
    try {
      let activeRoom = room;
      let activeTeams = teams;
      if (firebaseEnabled && db && (!room || room.id === "demo")) {
        await ensureAnonymousUser();
        const found = await findClassByCode(info.code);
        if (!found) throw new Error("입장 코드를 찾을 수 없습니다.");
        activeRoom = found as ClassRoom;
        const teamDocs = await getDocs(refs.teams(activeRoom.id));
        activeTeams = teamDocs.docs.map((item) => ({ id: item.id, ...item.data() }) as Team);
        setRoom(activeRoom);
        setTeams(activeTeams);
      }
      if (!activeRoom) throw new Error("먼저 입장 코드를 확인해 주세요.");

      let teamId = info.teamId;
      if (teamId === "auto") {
        const memberCounts = await Promise.all(
          activeTeams.map(async (team) => {
            if (!firebaseEnabled || activeRoom?.id === "demo") {
              return members.filter((member) => member.teamId === team.id).length;
            }
            const memberDocs = await getDocs(refs.members(activeRoom!.id, team.id));
            return memberDocs.size;
          }),
        );
        teamId = [...activeTeams].sort(
          (a, b) =>
            memberCounts[activeTeams.findIndex((team) => team.id === a.id)] -
            memberCounts[activeTeams.findIndex((team) => team.id === b.id)],
        )[0]?.id;
      }
      if (!teamId) throw new Error("입장할 모둠을 선택해 주세요.");

      const user = firebaseEnabled ? await ensureAnonymousUser() : null;
      const member: Member = {
        id: user?.uid ?? `demo-${Date.now()}`,
        name: info.name,
        characterId: info.characterId,
        teamId,
        joinedAt: Date.now(),
        online: true,
      };
      setStudent(member);
      setMembers((current) => [...current, member]);
      if (firebaseEnabled && activeRoom.id !== "demo") {
        await setDoc(refs.member(activeRoom.id, teamId, member.id), {
          name: member.name,
          characterId: member.characterId,
          teamId,
          joinedAt: Date.now(),
          online: true,
        });
      }
      setView("student");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "입장에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function finishGame() {
    if (!room) return;
    const scored = teams.map((team) => ({
      ...team,
      score: calculateScore(
        team,
        reports.filter((report) =>
          members.some((member) => member.id === report.studentId && member.teamId === team.id),
        ),
        room.durationMinutes,
        room.startedAt,
      ),
    }));
    setTeams(scored);
    if (firebaseEnabled && room.id !== "demo" && db) {
      const batch = writeBatch(db);
      scored.forEach((team) => batch.update(refs.team(room.id, team.id), { score: team.score }));
      batch.update(refs.class(room.id), { phase: "finished" });
      await batch.commit();
    }
    setRoom({ ...room, phase: "finished" });
  }

  return (
    <main>
      <header className="topbar">
        <button className="brand" onClick={() => setView("home")}>
          <span className="brand-mark">?</span>
          <span>논증 탐정단</span>
        </button>
        {room && view !== "home" && (
          <div className="room-chip">
            <span>{room.name}</span>
            <strong>{room.code}</strong>
          </div>
        )}
      </header>

      {notice && (
        <button className="notice" onClick={() => setNotice("")}>
          {notice}
        </button>
      )}

      {view === "home" && (
        <HomeScreen
          onTeacher={() => setView("teacher-create")}
          onStudent={() => setView("student-join")}
          onDemo={enterDemo}
        />
      )}
      {view === "teacher-create" && <TeacherCreate onSubmit={createClass} busy={busy} />}
      {view === "teacher" && room && (
        <TeacherDashboard
          room={room}
          teams={teams}
          members={members}
          reports={reports}
          onPhase={async (phase) =>
            patchRoom({ phase, ...(phase === "round1" ? { startedAt: Date.now() } : {}) })
          }
          onHint={(teamId, hint) => patchTeam(teamId, { hintSent: hint })}
          onFinish={finishGame}
        />
      )}
      {view === "student-join" && (
        <StudentJoin
          teams={teams}
          defaultCode={room?.code ?? ""}
          busy={busy}
          onSubmit={joinClass}
          onDemo={() => enterDemo("student")}
        />
      )}
      {view === "student" && room && student && selectedTeam && (
        <StudentGame
          room={room}
          team={selectedTeam}
          student={student}
          reports={reports}
          onTeamPatch={(patch) => patchTeam(selectedTeam.id, patch)}
          onReport={async (report) => {
            setReports((current) => [
              ...current.filter((item) => item.studentId !== report.studentId),
              report,
            ]);
            if (firebaseEnabled && room.id !== "demo") {
              await setDoc(refs.report(room.id, selectedTeam.id, student.id), report);
            }
          }}
        />
      )}
    </main>
  );
}

function HomeScreen({
  onTeacher,
  onStudent,
  onDemo,
}: {
  onTeacher: () => void;
  onStudent: () => void;
  onDemo: (target: "teacher" | "student") => void;
}) {
  return (
    <section className="hero">
      <div className="hero-copy">
        <span className="eyebrow">중학교 국어 · 실시간 협동 게임</span>
        <h1>
          뒤섞인 문장 속
          <br />
          <em>논리의 단서</em>를 찾아라!
        </h1>
        <p>
          탐정 친구들과 문장을 복원하고, 연역·귀납·유추의 비밀을 밝혀 보세요.
        </p>
        <div className="hero-actions">
          <button className="primary large" onClick={onStudent}>
            <LogIn /> 학생 입장하기
          </button>
          <button className="secondary large" onClick={onTeacher}>
            <ShieldCheck /> 교사 수업 만들기
          </button>
        </div>
        {!firebaseEnabled && (
          <div className="demo-actions">
            <span title={`필요한 환경변수: ${missingFirebaseEnv.join(", ")}`}>
              Firebase 미설정 · 데모로 둘러보기
            </span>
            <button onClick={() => onDemo("teacher")}>교사 데모</button>
            <button onClick={() => onDemo("student")}>학생 데모</button>
          </div>
        )}
      </div>
      <div className="detective-board">
        <div className="moon" />
        <span className="big-emoji">🦊</span>
        <div className="clue clue-one">연역?</div>
        <div className="clue clue-two">귀납!</div>
        <div className="clue clue-three">유추</div>
        <div className="magnifier">🔎</div>
      </div>
    </section>
  );
}

function TeacherCreate({
  onSubmit,
  busy,
}: {
  onSubmit: (form: {
    name: string;
    code: string;
    duration: number;
    teamCount: number;
    teamText: string;
  }) => void;
  busy: boolean;
}) {
  const [name, setName] = useState("2학년 3반 국어");
  const [code, setCode] = useState("LOGIC6");
  const [duration, setDuration] = useState(20);
  const [teamCount, setTeamCount] = useState(3);
  const [teamText, setTeamText] = useState(sampleInput);

  return (
    <section className="page-shell">
      <div className="section-heading">
        <span className="step">교사 준비실</span>
        <h1>새 사건 수업 만들기</h1>
        <p>수업 정보와 모둠별 논증 글을 입력하세요. 저장할 때 문장이 자동으로 섞입니다.</p>
      </div>
      <form
        className="create-grid"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit({ name, code, duration, teamCount, teamText });
        }}
      >
        <div className="panel form-panel">
          <label>
            수업명
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label>
            입장 코드
            <input
              value={code}
              maxLength={8}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
              required
            />
          </label>
          <div className="two-columns">
            <label>
              제한 시간(분)
              <input
                type="number"
                min={5}
                max={60}
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
              />
            </label>
            <label>
              모둠 수
              <input
                type="number"
                min={1}
                max={8}
                value={teamCount}
                onChange={(e) => setTeamCount(Number(e.target.value))}
              />
            </label>
          </div>
          <div className="format-help">
            <BookOpenCheck />
            <p>
              <strong>입력 규칙</strong>
              <br />
              <code>[1모둠]</code> 다음 줄부터 올바른 문장 순서로 적고 마지막 줄에{" "}
              <code>#연역</code>, <code>#귀납</code>, <code>#유추</code>를 적습니다.
            </p>
          </div>
        </div>
        <div className="panel editor-panel">
          <label>
            모둠별 논증 예시 글
            <textarea value={teamText} onChange={(e) => setTeamText(e.target.value)} />
          </label>
          <button className="primary full" disabled={busy}>
            <Sparkles /> {busy ? "사건 파일 만드는 중..." : "저장하고 수업 만들기"}
          </button>
        </div>
      </form>
    </section>
  );
}

function TeacherDashboard({
  room,
  teams,
  members,
  reports,
  onPhase,
  onHint,
  onFinish,
}: {
  room: ClassRoom;
  teams: Team[];
  members: Member[];
  reports: Report[];
  onPhase: (phase: GamePhase) => void;
  onHint: (teamId: string, hint: string) => void;
  onFinish: () => void;
}) {
  const [hintTexts, setHintTexts] = useState<Record<string, string>>({});

  return (
    <section className="page-shell">
      <div className="dashboard-head">
        <div>
          <span className="eyebrow">교사 관제실</span>
          <h1>{room.name}</h1>
          <p>학생 입장 코드 <strong className="code-display">{room.code}</strong></p>
        </div>
        <div className="phase-controls">
          <span className={`status status-${room.phase}`}>{phaseLabel(room.phase)}</span>
          {room.phase === "lobby" && (
            <button className="primary" onClick={() => onPhase("round1")}>
              <Play /> ROUND 1 시작
            </button>
          )}
          {room.phase === "round1" && (
            <button className="primary" onClick={() => onPhase("round2")}>
              ROUND 2 열기 <ChevronRight />
            </button>
          )}
          {room.phase === "round2" && (
            <button className="danger" onClick={onFinish}>
              <Trophy /> 게임 종료·채점
            </button>
          )}
        </div>
      </div>

      <div className="summary-strip">
        <Summary icon={<Users />} label="입장 학생" value={`${members.length}명`} />
        <Summary
          icon={<BookOpenCheck />}
          label="ROUND 1 제출"
          value={`${teams.filter((team) => team.round1SubmittedAt).length}/${teams.length}`}
        />
        <Summary
          icon={<Send />}
          label="ROUND 2 제출"
          value={`${reports.length}/${members.length || 0}`}
        />
        <Summary icon={<Clock3 />} label="제한 시간" value={`${room.durationMinutes}분`} />
      </div>

      <div className="team-grid">
        {teams
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((team) => {
            const teamMembers = members.filter((member) => member.teamId === team.id);
            const teamReports = reports.filter((report) =>
              teamMembers.some((member) => member.id === report.studentId),
            );
            return (
              <article className="team-panel" key={team.id}>
                <div className="team-title">
                  <div>
                    <span className="team-number">{team.name}</span>
                    <strong>
                      {team.round1SubmittedAt
                        ? "1차 수사 완료"
                        : room.phase === "lobby"
                          ? "대기 중"
                          : "수사 중"}
                    </strong>
                  </div>
                  {room.phase === "finished" && <b className="score">{team.score}점</b>}
                </div>
                <div className="member-row">
                  {teamMembers.length ? (
                    teamMembers.map((member) => {
                      const character = characters.find((item) => item.id === member.characterId);
                      return (
                        <span title={member.name} key={member.id}>
                          {character?.emoji} {member.name}
                        </span>
                      );
                    })
                  ) : (
                    <small>아직 입장한 학생이 없습니다.</small>
                  )}
                </div>
                <div className="mini-order">
                  {team.currentOrder.map((sentence, index) => (
                    <p
                      key={`${sentence}-${index}`}
                      className={
                        team.round1SubmittedAt && sentence === team.originalSentences[index]
                          ? "correct"
                          : ""
                      }
                    >
                      <b>{index + 1}</b> {sentence}
                    </p>
                  ))}
                </div>
                <div className="team-meta">
                  <span>선택: <strong>{team.selectedType ?? "미선택"}</strong></span>
                  <span>설명: <strong>{teamReports.length}명</strong></span>
                </div>
                {team.hintRequested && !team.hintSent && (
                  <div className="hint-box">
                    <label>
                      <Lightbulb /> 힌트 요청 도착
                      <input
                        placeholder="이 모둠에 보낼 힌트"
                        value={hintTexts[team.id] ?? ""}
                        onChange={(e) =>
                          setHintTexts((current) => ({ ...current, [team.id]: e.target.value }))
                        }
                      />
                    </label>
                    <button
                      onClick={() => {
                        const hint = hintTexts[team.id]?.trim();
                        if (hint) onHint(team.id, hint);
                      }}
                    >
                      보내기
                    </button>
                  </div>
                )}
                {team.hintSent && <p className="sent-hint">보낸 힌트: {team.hintSent}</p>}
                {room.phase === "finished" && (
                  <>
                    <div className="badges">
                      {getBadges(team, teamReports).map((badge) => (
                        <span key={badge}>🏅 {badge}</span>
                      ))}
                    </div>
                    <div className="report-list">
                      {teamReports.map((report) => (
                        <div key={report.studentId}>
                          <strong>{report.studentName} · {report.reasonChoice}</strong>
                          <p>{report.explanation}</p>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </article>
            );
          })}
      </div>
    </section>
  );
}

function StudentJoin({
  teams,
  defaultCode,
  busy,
  onSubmit,
  onDemo,
}: {
  teams: Team[];
  defaultCode: string;
  busy: boolean;
  onSubmit: (info: {
    code: string;
    name: string;
    characterId: CharacterId;
    teamId: string;
  }) => void;
  onDemo: () => void;
}) {
  const [code, setCode] = useState(defaultCode);
  const [name, setName] = useState("");
  const [characterId, setCharacterId] = useState<CharacterId>("fox");
  const [teamId, setTeamId] = useState("auto");

  useEffect(() => setCode(defaultCode), [defaultCode]);

  return (
    <section className="join-shell">
      <div className="section-heading centered">
        <span className="step">탐정 등록소</span>
        <h1>수사팀에 합류하세요</h1>
        <p>입장 코드와 이름을 쓰고 나만의 탐정 캐릭터를 고르세요.</p>
      </div>
      <form
        className="panel join-panel"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit({ code, name, characterId, teamId });
        }}
      >
        <div className="join-fields">
          <label>
            입장 코드
            <input
              className="code-input"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="예: LOGIC6"
              required
            />
          </label>
          <label>
            탐정 이름
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="실명을 입력하세요"
              required
            />
          </label>
          <label>
            모둠 선택
            <select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
              <option value="auto">자동 배정</option>
              {teams.map((team) => (
                <option value={team.id} key={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <fieldset>
          <legend>탐정 캐릭터 선택</legend>
          <div className="character-grid">
            {characters.map((character) => (
              <label
                className={`character-card ${characterId === character.id ? "selected" : ""}`}
                key={character.id}
                style={{ "--character-color": character.color } as React.CSSProperties}
              >
                <input
                  type="radio"
                  name="character"
                  checked={characterId === character.id}
                  onChange={() => setCharacterId(character.id)}
                />
                <span>{character.emoji}</span>
                <strong>{character.name}</strong>
              </label>
            ))}
          </div>
        </fieldset>
        <button className="primary full large" disabled={busy}>
          <LogIn /> {busy ? "입장 확인 중..." : "탐정단 입장하기"}
        </button>
        {!firebaseEnabled && !defaultCode && (
          <button type="button" className="text-button" onClick={onDemo}>
            데모 수업으로 연습하기
          </button>
        )}
      </form>
    </section>
  );
}

function StudentGame({
  room,
  team,
  student,
  reports,
  onTeamPatch,
  onReport,
}: {
  room: ClassRoom;
  team: Team;
  student: Member;
  reports: Report[];
  onTeamPatch: (patch: Partial<Team>) => void;
  onReport: (report: Report) => void;
}) {
  const [reasonChoice, setReasonChoice] = useState<"A" | "B" | "C">("A");
  const [explanation, setExplanation] = useState("");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const character = characters.find((item) => item.id === student.characterId);
  const myReport = reports.find((report) => report.studentId === student.id);

  function dragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id || team.round1SubmittedAt) return;
    const oldIndex = team.currentOrder.indexOf(String(active.id));
    const newIndex = team.currentOrder.indexOf(String(over.id));
    onTeamPatch({ currentOrder: arrayMove(team.currentOrder, oldIndex, newIndex) });
  }

  if (room.phase === "lobby") {
    return (
      <section className="waiting-room">
        <span className="character-hero">{character?.emoji}</span>
        <span className="eyebrow">{team.name} · {student.name} 탐정</span>
        <h1>사건 파일이 열리기를 기다리는 중...</h1>
        <p>교사가 ROUND 1을 시작하면 자동으로 화면이 바뀝니다.</p>
        <div className="pulse-dots"><i /><i /><i /></div>
      </section>
    );
  }

  if (room.phase === "finished") {
    return (
      <section className="result-shell">
        <span className="eyebrow">수사 결과 보고서</span>
        <div className="result-score">
          <span>{character?.emoji}</span>
          <strong>{team.score}</strong>
          <small>점</small>
        </div>
        <h1>{team.name}, 사건 수고했어요!</h1>
        <div className="badges result-badges">
          {getBadges(team, reports.filter((report) => report.studentId === student.id)).map(
            (badge) => <span key={badge}>🏅 {badge}</span>,
          )}
        </div>
        <div className="answer-review panel">
          <p>문장 배열 <strong>{arraysEqual(team.currentOrder, team.originalSentences) ? "정답" : "다시 살펴보기"}</strong></p>
          <p>논증 방법 <strong>{team.correctType}</strong></p>
          <p>나의 설명 <strong>{myReport?.explanation ?? "미제출"}</strong></p>
        </div>
      </section>
    );
  }

  if (room.phase === "round2") {
    return (
      <section className="round-shell narrow">
        <RoundHeader round="ROUND 2" title="왜 그렇게 판단했나요?" team={team} student={student} />
        <div className="panel report-form">
          <p className="instruction">먼저 가장 알맞은 이유를 하나 선택하세요.</p>
          <div className="reason-options">
            {(Object.entries(reasonOptions) as Array<["A" | "B" | "C", string]>).map(
              ([key, text]) => (
                <label className={reasonChoice === key ? "selected" : ""} key={key}>
                  <input
                    type="radio"
                    checked={reasonChoice === key}
                    onChange={() => setReasonChoice(key)}
                  />
                  <b>{key}</b>
                  <span>{text}</span>
                </label>
              ),
            )}
          </div>
          <label className="explanation-field">
            나의 짧은 설명
            <textarea
              value={explanation}
              onChange={(e) => setExplanation(e.target.value)}
              placeholder="문장 속 어떤 단서를 보고 판단했는지 1~2문장으로 써 보세요."
              maxLength={200}
            />
            <small>{explanation.length}/200자 · 10자 이상 쓰면 설명 점수를 받을 수 있어요.</small>
          </label>
          <button
            className="primary full large"
            disabled={explanation.trim().length < 10}
            onClick={() =>
              onReport({
                studentId: student.id,
                studentName: student.name,
                teamId: team.id,
                reasonChoice,
                explanation: explanation.trim(),
                submittedAt: Date.now(),
              })
            }
          >
            <Send /> {myReport ? "설명 다시 제출하기" : "개인 수사 보고서 제출"}
          </button>
          {myReport && <p className="success-message">✓ 보고서가 저장되었습니다. 친구들이 마칠 때까지 기다려 주세요.</p>}
        </div>
      </section>
    );
  }

  return (
    <section className="round-shell">
      <RoundHeader round="ROUND 1" title="사건의 문장을 복원하라" team={team} student={student} />
      <div className="game-layout">
        <div className="card-stage">
          <div className="instruction-row">
            <p><strong>문장을 드래그</strong>해서 올바른 순서로 배열하세요.</p>
            <span><Users size={18} /> 모둠원과 실시간 공유 중</span>
          </div>
          <DndContext sensors={sensors} onDragEnd={dragEnd}>
            <SortableContext items={team.currentOrder} strategy={verticalListSortingStrategy}>
              <div className="sentence-list">
                {team.currentOrder.map((sentence, index) => (
                  <SortableCard id={sentence} index={index} key={sentence} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>
        <aside className="deduction-panel panel">
          <h2>논증 방법은?</h2>
          <p>문장 사이의 관계를 살펴보고 하나를 선택하세요.</p>
          <div className="type-options">
            {(["연역", "귀납", "유추"] as ArgumentType[]).map((type) => (
              <button
                className={team.selectedType === type ? "selected" : ""}
                onClick={() => onTeamPatch({ selectedType: type })}
                disabled={Boolean(team.round1SubmittedAt)}
                key={type}
              >
                <span>{type === "연역" ? "▽" : type === "귀납" ? "△" : "↔"}</span>
                <strong>{type}</strong>
              </button>
            ))}
          </div>
          {team.hintSent ? (
            <div className="received-hint"><Lightbulb /> <span><b>교사의 힌트</b>{team.hintSent}</span></div>
          ) : (
            <button
              className="hint-request"
              disabled={team.hintRequested}
              onClick={() => onTeamPatch({ hintRequested: true })}
            >
              <Lightbulb /> {team.hintRequested ? "힌트를 기다리는 중" : "힌트 요청 (모둠당 1회)"}
            </button>
          )}
          <button
            className="primary full large"
            disabled={!team.selectedType || Boolean(team.round1SubmittedAt)}
            onClick={() => onTeamPatch({ round1SubmittedAt: Date.now() })}
          >
            <ShieldCheck /> {team.round1SubmittedAt ? "ROUND 1 제출 완료" : "ROUND 1 제출"}
          </button>
          {team.round1SubmittedAt && (
            <p className="success-message">교사가 ROUND 2를 열 때까지 함께 기다려 주세요.</p>
          )}
        </aside>
      </div>
    </section>
  );
}

function RoundHeader({
  round,
  title,
  team,
  student,
}: {
  round: string;
  title: string;
  team: Team;
  student: Member;
}) {
  const character = characters.find((item) => item.id === student.characterId);
  return (
    <div className="round-header">
      <div>
        <span className="step">{round}</span>
        <h1>{title}</h1>
      </div>
      <div className="student-chip">
        <span>{character?.emoji}</span>
        <div><strong>{student.name} 탐정</strong><small>{team.name}</small></div>
      </div>
    </div>
  );
}

function Summary({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="summary-item">{icon}<span>{label}<strong>{value}</strong></span></div>;
}

function phaseLabel(phase: GamePhase) {
  return { lobby: "입장 대기", round1: "ROUND 1 진행", round2: "ROUND 2 진행", finished: "게임 종료" }[phase];
}
