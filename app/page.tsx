"use client";

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { useEffect, useRef, useState } from "react";
import {
  BookOpenCheck,
  CheckCircle2,
  ChevronRight,
  Clock3,
  GripVertical,
  Lightbulb,
  LogIn,
  Play,
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
  scoreExplanation,
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
#유추

[4모둠]
모든 금속은 열을 받으면 팽창한다.
철은 금속이다.
따라서 철은 열을 받으면 팽창한다.
#연역

[5모둠]
우리 반 학생 세 명은 아침 독서 후 집중력이 좋아졌다.
다른 반 학생들도 아침 독서 후 집중력이 좋아졌다.
따라서 아침 독서는 대체로 집중력 향상에 도움이 된다.
#귀납

[6모둠]
스마트폰과 태블릿은 모두 화면을 터치해 조작한다.
스마트폰은 사용법을 쉽게 익힐 수 있다.
따라서 태블릿도 사용법을 쉽게 익힐 수 있을 것이다.
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
type AppScreen =
  | "home"
  | "teacher-create"
  | "teacher-dashboard"
  | "teacher-detail"
  | "student-join"
  | "student-lobby"
  | "student-round1"
  | "student-round2"
  | "student-result";

const teacherSessionKey = "argument-detectives:teacher";
const studentSessionKey = "argument-detectives:student";

interface StudentSession {
  code: string;
  roomId: string;
  classId: string;
  studentId: string;
  studentName: string;
  teamId: string;
  avatar: CharacterId;
  phase: GamePhase;
}

function phaseToStudentScreen(phase: GamePhase): AppScreen {
  return {
    lobby: "student-lobby",
    round1: "student-round1",
    round2: "student-round2",
    finished: "student-result",
  }[phase] as AppScreen;
}

function screenToStudentPhase(screen: AppScreen, fallback: GamePhase): GamePhase {
  const phases: Partial<Record<AppScreen, GamePhase>> = {
    "student-lobby": "lobby",
    "student-round1": "round1",
    "student-round2": "round2",
    "student-result": "finished",
  };
  const requestedPhase = phases[screen];
  if (!requestedPhase) return fallback;

  const phaseOrder: GamePhase[] = ["lobby", "round1", "round2", "finished"];
  return phaseOrder.indexOf(requestedPhase) <= phaseOrder.indexOf(fallback)
    ? requestedPhase
    : fallback;
}

function getWinningTeams(teams: Team[]) {
  if (!teams.length || teams.some((team) => team.score === null)) return [];
  const highestScore = Math.max(...teams.map((team) => team.score ?? 0));
  return teams.filter((team) => team.score === highestScore);
}

function getDefaultHint(argumentType: ArgumentType) {
  return {
    귀납: "여러 사례를 보고 결론을 내렸나요?",
    연역: "일반 원리에서 출발했나요?",
    유추: "비슷한 점을 근거로 판단했나요?",
  }[argumentType];
}

function WinnerAnnouncement({
  winners,
  open,
  onClose,
}: {
  winners: Team[];
  open: boolean;
  onClose: () => void;
}) {
  if (!winners.length) return null;
  const isTie = winners.length > 1;
  const score = winners[0].score ?? 0;
  const winnerNames = winners.map((team) => team.name).join(", ");

  return (
    <>
      <div className="winner-banner">
        <Trophy />
        <strong>{isTie ? "공동 우승" : "우승 모둠"}: {winnerNames}</strong>
        <span>{score}점</span>
      </div>
      {open && (
        <div className="winner-modal-backdrop" role="presentation">
          <section
            className="winner-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="winner-modal-title"
          >
            <i className="winner-sparkle sparkle-one">✦</i>
            <i className="winner-sparkle sparkle-two">✧</i>
            <i className="winner-sparkle sparkle-three">✦</i>
            <Trophy className="winner-trophy" size={82} />
            <span className="eyebrow">{isTie ? "최종 공동 우승 발표" : "최종 우승 발표"}</span>
            <h2 id="winner-modal-title">
              🏆 {isTie ? "논증 탐정단 공동 우승!" : "논증 탐정단 우승!"}
            </h2>
            <div className="winner-team-list">
              {winners.map((team) => <strong key={team.id}>🎉 {team.name}</strong>)}
            </div>
            <p>최종 점수: <b>{score}점</b></p>
            <small>축하합니다!</small>
            <button className="primary large" onClick={onClose}>결과 확인하기</button>
          </section>
        </div>
      )}
    </>
  );
}

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
  const [appScreen, setAppScreen] = useState<AppScreen>("home");
  const [selectedTeacherTeamId, setSelectedTeacherTeamId] = useState<string | null>(null);
  const [studentJoinCode, setStudentJoinCode] = useState("");
  const [teacherCreateCode, setTeacherCreateCode] = useState("HDM");
  const [restoring, setRestoring] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const lastRoomPhaseRef = useRef<GamePhase | null>(null);

  const selectedTeam = teams.find((team) => team.id === student?.teamId) ?? null;

  function applyScreen(screen: AppScreen, teamId?: string | null) {
    setAppScreen(screen);
    if (screen === "home") setView("home");
    if (screen === "teacher-create") setView("teacher-create");
    if (screen === "teacher-dashboard" || screen === "teacher-detail") {
      setView("teacher");
      setSelectedTeacherTeamId(screen === "teacher-detail" ? teamId ?? null : null);
    }
    if (screen === "student-join") {
      setStudentJoinCode("");
      setView("student-join");
    }
    if (screen.startsWith("student-") && screen !== "student-join") setView("student");
  }

  function navigate(screen: AppScreen, options?: { replace?: boolean; teamId?: string | null }) {
    const state = { argumentDetectives: true, screen, teamId: options?.teamId ?? null };
    if (options?.replace) window.history.replaceState(state, "", window.location.href);
    else window.history.pushState(state, "", window.location.href);
    applyScreen(screen, options?.teamId);
  }

  function moveStudentStage(direction: "previous" | "next") {
    if (!room) return;

    const phases: GamePhase[] = ["lobby", "round1", "round2", "finished"];
    const currentPhase = screenToStudentPhase(appScreen, room.phase);
    const currentIndex = phases.indexOf(currentPhase);

    if (direction === "previous") {
      setNotice("");
      if (currentIndex <= 0) {
        navigate("student-join");
        return;
      }
      navigate(phaseToStudentScreen(phases[currentIndex - 1]));
      return;
    }

    const nextIndex = currentIndex + 1;
    const teacherPhaseIndex = phases.indexOf(room.phase);
    if (nextIndex >= phases.length || nextIndex > teacherPhaseIndex) {
      setNotice("아직 다음 단계가 열리지 않았습니다.");
      return;
    }

    setNotice("");
    navigate(phaseToStudentScreen(phases[nextIndex]));
  }

  useEffect(() => {
    const restoreSession = async () => {
      if (!firebaseEnabled || !db) {
        const screen = (window.history.state?.screen as AppScreen | undefined) ?? "home";
        applyScreen(screen, window.history.state?.teamId);
        window.history.replaceState(
          { argumentDetectives: true, screen, teamId: window.history.state?.teamId ?? null },
          "",
          window.location.href,
        );
        setRestoring(false);
        return;
      }

      try {
        const historyScreen = window.history.state?.screen as AppScreen | undefined;
        const teacherSession = JSON.parse(localStorage.getItem(teacherSessionKey) ?? "null") as
          | { roomId: string }
          | null;
        const studentSession = JSON.parse(
          localStorage.getItem(studentSessionKey) ?? "null",
        ) as StudentSession | null;

        if (
          studentSession &&
          (!historyScreen ||
            (historyScreen.startsWith("student-") && historyScreen !== "student-join"))
        ) {
          await ensureAnonymousUser();
          const [roomSnap, teamDocs, memberSnap] = await Promise.all([
            getDoc(refs.class(studentSession.roomId)),
            getDocs(refs.teams(studentSession.roomId)),
            getDoc(
              refs.member(
                studentSession.roomId,
                studentSession.teamId,
                studentSession.studentId,
              ),
            ),
          ]);
          if (roomSnap.exists() && memberSnap.exists()) {
            const restoredRoom = { id: roomSnap.id, ...roomSnap.data() } as ClassRoom;
            const restoredStudent = {
              id: memberSnap.id,
              ...memberSnap.data(),
            } as Member;
            setRoom(restoredRoom);
            setTeams(teamDocs.docs.map((item) => ({ id: item.id, ...item.data() }) as Team));
            setStudent(restoredStudent);
            lastRoomPhaseRef.current = restoredRoom.phase;
            localStorage.setItem(
              studentSessionKey,
              JSON.stringify({
                ...studentSession,
                code: restoredRoom.code,
                roomId: restoredRoom.id,
                classId: restoredRoom.id,
                studentName: restoredStudent.name,
                avatar: restoredStudent.characterId,
                phase: restoredRoom.phase,
              } satisfies StudentSession),
            );
            const screen =
              historyScreen?.startsWith("student-")
                ? historyScreen
                : phaseToStudentScreen(restoredRoom.phase);
            applyScreen(screen);
            window.history.replaceState(
              { argumentDetectives: true, screen, teamId: null },
              "",
              window.location.href,
            );
            setRestoring(false);
            return;
          }
          localStorage.removeItem(studentSessionKey);
        }

        if (
          teacherSession &&
          (!historyScreen ||
            historyScreen === "teacher-dashboard" ||
            historyScreen === "teacher-detail")
        ) {
          await ensureAnonymousUser();
          const [roomSnap, teamDocs] = await Promise.all([
            getDoc(refs.class(teacherSession.roomId)),
            getDocs(refs.teams(teacherSession.roomId)),
          ]);
          if (roomSnap.exists()) {
            setRoom({ id: roomSnap.id, ...roomSnap.data() } as ClassRoom);
            setTeams(teamDocs.docs.map((item) => ({ id: item.id, ...item.data() }) as Team));
            const screen =
              historyScreen === "teacher-detail" ? "teacher-detail" : "teacher-dashboard";
            applyScreen(screen, window.history.state?.teamId);
            window.history.replaceState(
              {
                argumentDetectives: true,
                screen,
                teamId: window.history.state?.teamId ?? null,
              },
              "",
              window.location.href,
            );
            setRestoring(false);
            return;
          }
          localStorage.removeItem(teacherSessionKey);
        }

        const screen = historyScreen ?? "home";
        applyScreen(screen === "teacher-detail" ? "teacher-create" : screen);
        window.history.replaceState(
          { argumentDetectives: true, screen, teamId: null },
          "",
          window.location.href,
        );
      } catch {
        applyScreen("home");
        window.history.replaceState(
          { argumentDetectives: true, screen: "home", teamId: null },
          "",
          window.location.href,
        );
      } finally {
        setRestoring(false);
      }
    };

    void restoreSession();
  }, []);

  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      const screen = event.state?.screen as AppScreen | undefined;
      if (screen) {
        applyScreen(screen, event.state?.teamId);
        return;
      }

      const fallback =
        view === "student"
          ? "student-join"
          : view === "teacher"
            ? "teacher-create"
            : "home";
      window.history.pushState(
        { argumentDetectives: true, screen: fallback, teamId: null },
        "",
        window.location.href,
      );
      applyScreen(fallback);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [view]);

  useEffect(() => {
    if (!room || view !== "student" || restoring) return;
    if (lastRoomPhaseRef.current === null) {
      lastRoomPhaseRef.current = room.phase;
      return;
    }
    if (lastRoomPhaseRef.current !== room.phase) {
      lastRoomPhaseRef.current = room.phase;
      const savedSession = JSON.parse(
        localStorage.getItem(studentSessionKey) ?? "null",
      ) as StudentSession | null;
      if (savedSession) {
        localStorage.setItem(
          studentSessionKey,
          JSON.stringify({ ...savedSession, phase: room.phase } satisfies StudentSession),
        );
      }
      navigate(phaseToStudentScreen(room.phase));
    }
  }, [room?.phase, view, restoring]);

  function openStudentJoin() {
    setStudentJoinCode("");
    navigate("student-join");
  }

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
    navigate(target === "teacher" ? "teacher-dashboard" : "student-join");
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
      const normalizedCode = form.code.trim().toUpperCase();
      if (!firebaseEnabled || !db) {
        const parsed = parseTeamText(form.teamText);
        if (parsed.length !== form.teamCount) {
          throw new Error(`모둠 수는 ${form.teamCount}개인데 입력된 글은 ${parsed.length}개입니다.`);
        }
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
        navigate("teacher-dashboard");
        setNotice("데모 모드로 수업을 만들었습니다. Firebase 설정 후에는 모든 기기에서 동기화됩니다.");
        return;
      }

      const firestore = db;
      const teacherUser = await ensureAnonymousUser();
      if (!teacherUser) throw new Error("교사 인증을 시작하지 못했습니다. 잠시 후 다시 시도해주세요.");
      const existingClass = await findClassByCode(normalizedCode);
      if (existingClass) {
        const existingRoom = existingClass as ClassRoom;
        if (existingRoom.teacherId !== teacherUser.uid) {
          await updateDoc(refs.class(existingRoom.id), { teacherId: teacherUser.uid });
          existingRoom.teacherId = teacherUser.uid;
        }
        const teamDocs = await getDocs(refs.teams(existingRoom.id));
        setRoom(existingRoom);
        setTeams(teamDocs.docs.map((item) => ({ id: item.id, ...item.data() }) as Team));
        localStorage.setItem(teacherSessionKey, JSON.stringify({ roomId: existingRoom.id }));
        localStorage.removeItem(studentSessionKey);
        navigate("teacher-dashboard");
        setNotice("이미 저장된 같은 입장 코드의 수업을 불러왔습니다.");
        return;
      }
      const parsed = parseTeamText(form.teamText);
      if (parsed.length !== form.teamCount) {
        throw new Error(`모둠 수는 ${form.teamCount}개인데 입력된 글은 ${parsed.length}개입니다.`);
      }
      const roomRef = await addDoc(collection(firestore, "classes"), {
        name: form.name,
        code: normalizedCode,
        durationMinutes: form.duration,
        teamCount: form.teamCount,
        phase: "lobby",
        startedAt: null,
        createdAt: Date.now(),
        teacherId: teacherUser.uid,
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
        code: normalizedCode,
        durationMinutes: form.duration,
        teamCount: form.teamCount,
        phase: "lobby",
        startedAt: null,
        createdAt: Date.now(),
        teacherId: teacherUser.uid,
      });
      localStorage.setItem(teacherSessionKey, JSON.stringify({ roomId: roomRef.id }));
      localStorage.removeItem(studentSessionKey);
      navigate("teacher-dashboard");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "수업 생성에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function resetCurrentClass() {
    if (!room || room.id === "demo" || !db) return;
    const confirmed = window.confirm(
      "이 입장 코드에 저장된 기존 수업 진행 상황과 결과가 삭제됩니다. 계속할까요?",
    );
    if (!confirmed) return;

    setBusy(true);
    setNotice("");
    try {
      const targetRoomId = room.id;
      const targetCode = room.code;
      const teamDocs = await getDocs(refs.teams(targetRoomId));
      for (const teamDoc of teamDocs.docs) {
        const [memberDocs, reportDocs] = await Promise.all([
          getDocs(refs.members(targetRoomId, teamDoc.id)),
          getDocs(refs.reports(targetRoomId, teamDoc.id)),
        ]);
        await Promise.all([
          ...memberDocs.docs.map((memberDoc) => deleteDoc(memberDoc.ref)),
          ...reportDocs.docs.map((reportDoc) => deleteDoc(reportDoc.ref)),
        ]);
        await deleteDoc(teamDoc.ref);
      }
      await deleteDoc(refs.class(targetRoomId));

      setRoom(null);
      setTeams([]);
      setMembers([]);
      setReports([]);
      setSelectedTeacherTeamId(null);
      setTeacherCreateCode(targetCode);
      localStorage.removeItem(teacherSessionKey);
      navigate("teacher-create");
      setNotice(`${targetCode} 코드의 기존 수업을 초기화했습니다. 새 수업 내용을 저장해 주세요.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "기존 수업 초기화에 실패했습니다.");
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
      const normalizedCode = info.code.trim().toUpperCase();
      if (!normalizedCode) throw new Error("입장 코드를 입력해 주세요.");

      let activeRoom: ClassRoom | null = null;
      let activeTeams: Team[] = [];
      if (firebaseEnabled && db) {
        await ensureAnonymousUser();
        const found = await findClassByCode(normalizedCode);
        if (!found) throw new Error("해당 입장 코드의 수업을 찾을 수 없습니다.");
        activeRoom = found as ClassRoom;
        const teamDocs = await getDocs(refs.teams(activeRoom.id));
        activeTeams = teamDocs.docs.map((item) => ({ id: item.id, ...item.data() }) as Team);
        setRoom(activeRoom);
        setTeams(activeTeams);
      } else if (room?.code === normalizedCode) {
        activeRoom = room;
        activeTeams = teams;
      }
      if (!activeRoom) throw new Error("해당 입장 코드의 수업을 찾을 수 없습니다.");

      const savedSession = JSON.parse(
        localStorage.getItem(studentSessionKey) ?? "null",
      ) as StudentSession | null;
      const reusableSession =
        savedSession?.code === normalizedCode && savedSession.classId === activeRoom.id
          ? savedSession
          : null;

      if (reusableSession && firebaseEnabled && activeRoom.id !== "demo") {
        const existingMember = await getDoc(
          refs.member(
            activeRoom.id,
            reusableSession.teamId,
            reusableSession.studentId,
          ),
        );
        if (existingMember.exists()) {
          const member = {
            id: existingMember.id,
            ...existingMember.data(),
          } as Member;
          setStudent(member);
          setMembers((current) => [
            ...current.filter((item) => item.id !== member.id),
            member,
          ]);
          setStudentJoinCode(normalizedCode);
          localStorage.setItem(
            studentSessionKey,
            JSON.stringify({
              code: normalizedCode,
              roomId: activeRoom.id,
              classId: activeRoom.id,
              studentId: member.id,
              studentName: member.name,
              teamId: member.teamId,
              avatar: member.characterId,
              phase: activeRoom.phase,
            } satisfies StudentSession),
          );
          localStorage.removeItem(teacherSessionKey);
          lastRoomPhaseRef.current = activeRoom.phase;
          navigate(phaseToStudentScreen(activeRoom.phase));
          return;
        }
      }

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
      if (!activeTeams.some((team) => team.id === teamId)) {
        throw new Error("이 수업에는 선택한 모둠이 없습니다. 자동 배정을 선택해주세요.");
      }

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
      setStudentJoinCode(normalizedCode);
      localStorage.setItem(
        studentSessionKey,
        JSON.stringify({
          code: normalizedCode,
          roomId: activeRoom.id,
          classId: activeRoom.id,
          teamId,
          studentId: member.id,
          studentName: member.name,
          avatar: member.characterId,
          phase: activeRoom.phase,
        } satisfies StudentSession),
      );
      localStorage.removeItem(teacherSessionKey);
      lastRoomPhaseRef.current = activeRoom.phase;
      navigate(phaseToStudentScreen(activeRoom.phase));
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

  if (restoring) {
    return (
      <main>
        <section className="waiting-room">
          <span className="eyebrow">논증 탐정단</span>
          <h1>수사 기록을 불러오는 중...</h1>
        </section>
      </main>
    );
  }

  return (
    <main>
      <header className="topbar">
        <button className="brand" onClick={() => navigate("home")}>
          <span className="brand-mark">?</span>
          <span>논증 탐정단</span>
        </button>
        {room && (view === "teacher" || view === "student") && (
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
          onTeacher={() => navigate("teacher-create")}
          onStudent={openStudentJoin}
          onDemo={enterDemo}
        />
      )}
      {view === "teacher-create" && (
        <TeacherCreate
          onSubmit={createClass}
          busy={busy}
          defaultCode={teacherCreateCode}
          onBack={() => window.history.back()}
        />
      )}
      {view === "teacher" && room && (
        <TeacherDashboard
          room={room}
          teams={teams}
          members={members}
          reports={reports}
          selectedTeamId={selectedTeacherTeamId}
          onSelectTeam={(teamId) => {
            if (teamId) navigate("teacher-detail", { teamId });
            else window.history.back();
          }}
          onBack={() => window.history.back()}
          onForward={() => window.history.forward()}
          onReset={resetCurrentClass}
          busy={busy}
          onPhase={async (phase) =>
            patchRoom({
              phase,
              ...(phase === "round1" && !room.startedAt ? { startedAt: Date.now() } : {}),
            })
          }
          onHint={(teamId, hint) => patchTeam(teamId, { hintSent: hint })}
          onFinish={finishGame}
        />
      )}
      {view === "student-join" && (
        <StudentJoin
          teams={teams}
          defaultCode={studentJoinCode}
          busy={busy}
          onSubmit={joinClass}
          onDemo={() => enterDemo("student")}
        />
      )}
      {view === "student" && room && student && selectedTeam && (
        <StudentGame
          room={room}
          team={selectedTeam}
          teams={teams}
          student={student}
          teamMemberCount={members.filter((member) => member.teamId === selectedTeam.id).length}
          displayPhase={screenToStudentPhase(appScreen, room.phase)}
          onBack={() => moveStudentStage("previous")}
          onNext={() => moveStudentStage("next")}
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
  defaultCode,
  onBack,
}: {
  onSubmit: (form: {
    name: string;
    code: string;
    duration: number;
    teamCount: number;
    teamText: string;
  }) => void;
  busy: boolean;
  defaultCode: string;
  onBack: () => void;
}) {
  const [name, setName] = useState("3학년 5반 국어");
  const [code, setCode] = useState(defaultCode);
  const [duration, setDuration] = useState(20);
  const [teamCount, setTeamCount] = useState(6);
  const [teamText, setTeamText] = useState(sampleInput);

  useEffect(() => setCode(defaultCode), [defaultCode]);

  return (
    <section className="page-shell">
      <button className="back-button" onClick={onBack}>
        ← 이전 화면
      </button>
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
  selectedTeamId,
  onSelectTeam,
  onBack,
  onForward,
  onReset,
  busy,
  onPhase,
  onHint,
  onFinish,
}: {
  room: ClassRoom;
  teams: Team[];
  members: Member[];
  reports: Report[];
  selectedTeamId: string | null;
  onSelectTeam: (teamId: string | null) => void;
  onBack: () => void;
  onForward: () => void;
  onReset: () => void;
  busy: boolean;
  onPhase: (phase: GamePhase) => void;
  onHint: (teamId: string, hint: string) => void;
  onFinish: () => void;
}) {
  const [hintTexts, setHintTexts] = useState<Record<string, string>>({});
  const [hintRequestTeamId, setHintRequestTeamId] = useState<string | null>(null);
  const [popupHint, setPopupHint] = useState("");
  const [completionAlert, setCompletionAlert] = useState<"round1" | "round2" | null>(null);
  const [winnerPopupOpen, setWinnerPopupOpen] = useState(false);
  const round1AlertedRef = useRef(false);
  const round2AlertedRef = useRef(false);
  const dismissedHintRequestsRef = useRef<Set<string>>(new Set());
  const winners = getWinningTeams(teams);
  const winnerSeenKey = `argument-detectives:winner-seen:teacher:${room.id}`;

  useEffect(() => {
    if (room.phase !== "finished" || !winners.length) return;
    if (localStorage.getItem(winnerSeenKey) !== "true") setWinnerPopupOpen(true);
  }, [room.phase, winners.length, winnerSeenKey]);

  function closeWinnerPopup() {
    localStorage.setItem(winnerSeenKey, "true");
    setWinnerPopupOpen(false);
  }

  const allRound1Submitted =
    teams.length > 0 && teams.every((team) => Boolean(team.round1SubmittedAt));
  const allRound2Submitted =
    teams.length > 0 &&
    teams.every((team) => {
      const teamMembers = members.filter((member) => member.teamId === team.id);
      const submittedIds = new Set(
        reports
          .filter((report) => report.teamId === team.id)
          .map((report) => report.studentId),
      );
      return teamMembers.length > 0 && teamMembers.every((member) => submittedIds.has(member.id));
    });

  useEffect(() => {
    if (
      room.phase === "round1" &&
      allRound1Submitted &&
      !round1AlertedRef.current
    ) {
      round1AlertedRef.current = true;
      setCompletionAlert("round1");
    }
    if (
      room.phase === "round2" &&
      allRound2Submitted &&
      !round2AlertedRef.current
    ) {
      round2AlertedRef.current = true;
      setCompletionAlert("round2");
    }
  }, [room.phase, allRound1Submitted, allRound2Submitted]);

  useEffect(() => {
    if (hintRequestTeamId) return;
    const pendingTeam = teams.find(
      (team) =>
        team.hintRequested &&
        !team.hintSent &&
        !dismissedHintRequestsRef.current.has(team.id),
    );
    if (pendingTeam) {
      const defaultHint = getDefaultHint(pendingTeam.correctType);
      const hintDraft = hintTexts[pendingTeam.id]?.trim() || defaultHint;
      setHintRequestTeamId(pendingTeam.id);
      setHintTexts((current) => ({ ...current, [pendingTeam.id]: hintDraft }));
      setPopupHint(hintDraft);
    }
  }, [teams, hintRequestTeamId, hintTexts]);

  const hintRequestTeam =
    teams.find((team) => team.id === hintRequestTeamId) ?? null;

  function closeHintPopup() {
    if (hintRequestTeamId) dismissedHintRequestsRef.current.add(hintRequestTeamId);
    setHintRequestTeamId(null);
    setPopupHint("");
  }

  function sendPopupHint() {
    const hint = popupHint.trim();
    if (!hintRequestTeam || !hint) return;
    setHintTexts((current) => ({ ...current, [hintRequestTeam.id]: hint }));
    onHint(hintRequestTeam.id, hint);
    setHintRequestTeamId(null);
    setPopupHint("");
  }

  function getTeamStage(team: Team, round2Complete: boolean) {
    if (room.phase === "finished") return "완료";
    if (room.phase === "lobby") return "입장 대기";
    if (room.phase === "round1") return team.round1SubmittedAt ? "ROUND 1 완료" : "ROUND 1";
    return round2Complete ? "ROUND 2 완료" : "ROUND 2";
  }

  return (
    <section className="page-shell">
      <div className="screen-history-controls">
        <button className="back-button" onClick={onBack}>
          ← 이전 화면
        </button>
        <button className="back-button" onClick={onForward}>
          다음 화면 →
        </button>
      </div>
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

      {room.phase === "finished" && (
        <WinnerAnnouncement
          winners={winners}
          open={winnerPopupOpen}
          onClose={closeWinnerPopup}
        />
      )}

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

      <div className="team-grid team-overview-grid">
        {teams
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((team) => {
            const teamMembers = members.filter((member) => member.teamId === team.id);
            const teamReports = reports.filter((report) =>
              teamMembers.some((member) => member.id === report.studentId),
            );
            const isRound2Complete =
              teamMembers.length > 0 && teamReports.length >= teamMembers.length;
            const isRound1Complete = Boolean(team.round1SubmittedAt);
            const isExpanded = selectedTeamId === team.id;
            const currentScore =
              room.phase === "finished"
                ? team.score
                : calculateScore(
                    team,
                    teamReports,
                    room.durationMinutes,
                    room.startedAt,
                  );
            return (
              <article
                className={`team-panel team-overview-card ${isExpanded ? "expanded" : ""} ${
                  isRound2Complete
                    ? "round2-complete"
                    : isRound1Complete
                      ? "round1-complete"
                      : ""
                }`}
                key={team.id}
              >
                <button
                  className="team-card-summary"
                  onClick={() => onSelectTeam(isExpanded ? null : team.id)}
                  aria-expanded={isExpanded}
                >
                  <div className="team-title">
                    <span className="team-number">{team.name}</span>
                    <span className={`team-stage stage-${room.phase}`}>
                      {(isRound1Complete || isRound2Complete) && <CheckCircle2 size={16} />}
                      {getTeamStage(team, isRound2Complete)}
                    </span>
                  </div>
                  <div className="team-progress-grid">
                    <span><small>입장 인원</small><strong>{teamMembers.length}명</strong></span>
                    <span><small>힌트</small><strong>{team.hintSent ? "사용" : team.hintRequested ? "요청" : "미사용"}</strong></span>
                    <span><small>ROUND 1</small><strong>{team.round1SubmittedAt ? "제출" : "미제출"}</strong></span>
                    <span><small>ROUND 2</small><strong>{teamReports.length}/{teamMembers.length || 0}명</strong></span>
                  </div>
                  <div className="team-member-names">
                    <small>학생</small>
                    <div>
                      {teamMembers.length ? (
                        teamMembers.map((member) => (
                          <span key={member.id}>{member.name}</span>
                        ))
                      ) : (
                        <em>입장 학생 없음</em>
                      )}
                    </div>
                  </div>
                  <div className="team-card-score">
                    <span>{room.phase === "finished" ? "최종 점수" : "현재 점수"}</span>
                    <strong>{currentScore ?? 0}점</strong>
                  </div>
                  <span className="detail-toggle">{isExpanded ? "상세 닫기" : "상세 보기"}</span>
                </button>

                {isExpanded && (
                  <div className="team-card-detail">
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
                      <span>논증 선택: <strong>{team.selectedType ?? "미선택"}</strong></span>
                      <span>개인 설명: <strong>{teamReports.length}명</strong></span>
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
                      <div className="badges">
                        {getBadges(team, teamReports, teamMembers.length).map((badge) => (
                          <span key={badge}>🏅 {badge}</span>
                        ))}
                      </div>
                    )}
                    {teamReports.length > 0 && (
                      <div className="report-list">
                        {teamReports.map((report) => (
                          <div key={report.studentId}>
                            <strong>
                              {report.studentName} · {report.reasonChoice}
                              <b>설명 {scoreExplanation(team, report)}/10점</b>
                            </strong>
                            <p>{report.explanation}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
          })}
      </div>

      <div className="teacher-danger-zone teacher-danger-zone-bottom">
        <div>
          <strong>이 코드로 새 수업을 시작해야 하나요?</strong>
          <span>현재 수업의 진행 상황과 결과만 삭제하고 같은 코드를 다시 사용할 수 있습니다.</span>
        </div>
        <button className="danger" onClick={onReset} disabled={busy}>
          이 코드의 기존 수업 초기화
        </button>
      </div>

      {hintRequestTeam && (
        <div className="completion-modal-backdrop" role="presentation">
          <section
            className="completion-modal hint-request-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="hint-request-modal-title"
          >
            <Lightbulb size={48} />
            <span className="eyebrow">힌트 요청</span>
            <h2 id="hint-request-modal-title">
              {hintRequestTeam.name}이 힌트를 요청했습니다.
            </h2>
            <label>
              보낼 힌트
              <textarea
                value={popupHint}
                onChange={(event) => setPopupHint(event.target.value)}
                placeholder={`${hintRequestTeam.name} 학생들에게 보낼 힌트를 입력하세요.`}
                autoFocus
              />
            </label>
            <div className="modal-actions">
              <button className="secondary" onClick={closeHintPopup}>
                닫기
              </button>
              <button
                className="primary"
                onClick={sendPopupHint}
                disabled={!popupHint.trim()}
              >
                <Send /> 힌트 보내기
              </button>
            </div>
          </section>
        </div>
      )}

      {completionAlert && (
        <div className="completion-modal-backdrop" role="presentation">
          <section
            className="completion-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="completion-modal-title"
          >
            <CheckCircle2 size={54} />
            <span className="eyebrow">
              {completionAlert === "round1" ? "ROUND 1" : "ROUND 2"}
            </span>
            <h2 id="completion-modal-title">🎉 모든 모둠 제출 완료!</h2>
            <p>다음 단계로 이동할 준비가 되었습니다.</p>
            <button className="primary large" onClick={() => setCompletionAlert(null)}>
              확인
            </button>
          </section>
        </div>
      )}
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

  useEffect(() => {
    setCode(defaultCode);
    setName("");
    setCharacterId("fox");
    setTeamId("auto");
  }, [defaultCode]);

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
              placeholder="예: HDM3"
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
              {Array.from({ length: 6 }, (_, index) => {
                const id = `team-${index + 1}`;
                const team = teams.find((item) => item.id === id);
                return (
                  <option value={id} key={id}>
                    {team?.name ?? `${index + 1}모둠`}
                  </option>
                );
              })}
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

function StudentStageControls({
  onPrevious,
  onNext,
  floating = false,
}: {
  onPrevious: () => void;
  onNext: () => void;
  floating?: boolean;
}) {
  return (
    <div className={`student-stage-controls${floating ? " floating" : ""}`}>
      <button className="back-button" onClick={onPrevious} type="button">
        ← 이전 단계
      </button>
      <button className="back-button student-next-button" onClick={onNext} type="button">
        다음 단계 →
      </button>
    </div>
  );
}

function StudentGame({
  room,
  team,
  teams,
  student,
  teamMemberCount,
  displayPhase,
  onBack,
  onNext,
  reports,
  onTeamPatch,
  onReport,
}: {
  room: ClassRoom;
  team: Team;
  teams: Team[];
  student: Member;
  teamMemberCount: number;
  displayPhase: GamePhase;
  onBack: () => void;
  onNext: () => void;
  reports: Report[];
  onTeamPatch: (patch: Partial<Team>) => void;
  onReport: (report: Report) => void;
}) {
  const [reasonChoice, setReasonChoice] = useState<"A" | "B" | "C">("A");
  const [explanation, setExplanation] = useState("");
  const [hintPopupOpen, setHintPopupOpen] = useState(false);
  const [winnerPopupOpen, setWinnerPopupOpen] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const draftReadyRef = useRef(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const character = characters.find((item) => item.id === student.characterId);
  const myReport = reports.find((report) => report.studentId === student.id);
  const draftKey = `argument-detectives:report-draft:${room.id}:${student.id}`;
  const seenHintKey = `argument-detectives:seen-hint:${room.id}:${student.id}`;
  const winnerSeenKey = `argument-detectives:winner-seen:student:${room.id}:${student.id}`;
  const winners = getWinningTeams(teams);

  useEffect(() => {
    if (displayPhase !== "finished" || !winners.length) return;
    if (localStorage.getItem(winnerSeenKey) !== "true") setWinnerPopupOpen(true);
  }, [displayPhase, winners.length, winnerSeenKey]);

  useEffect(() => {
    if (!team.hintSent) {
      setHintPopupOpen(false);
      return;
    }
    setHintPopupOpen(localStorage.getItem(seenHintKey) !== team.hintSent);
  }, [seenHintKey, team.hintSent]);

  useEffect(() => {
    const savedDraft = JSON.parse(localStorage.getItem(draftKey) ?? "null") as
      | { reasonChoice: "A" | "B" | "C"; explanation: string }
      | null;
    if (myReport) {
      setReasonChoice(myReport.reasonChoice);
      setExplanation(myReport.explanation);
    } else if (savedDraft) {
      setReasonChoice(savedDraft.reasonChoice);
      setExplanation(savedDraft.explanation);
    }
  }, [draftKey, myReport?.submittedAt]);

  useEffect(() => {
    if (!draftReadyRef.current) {
      draftReadyRef.current = true;
      return;
    }
    if (myReport) return;
    localStorage.setItem(draftKey, JSON.stringify({ reasonChoice, explanation }));
  }, [draftKey, reasonChoice, explanation, myReport]);

  function unlockAudio() {
    if (typeof window === "undefined") return;
    const AudioContextClass = window.AudioContext;
    if (!audioContextRef.current) audioContextRef.current = new AudioContextClass();
    if (audioContextRef.current.state === "suspended") void audioContextRef.current.resume();
  }

  function playMoveSound() {
    unlockAudio();
    const context = audioContextRef.current;
    if (!context || context.state !== "running") return;

    const now = context.currentTime;
    const ring = (
      frequency: number,
      volume: number,
      delay: number,
      duration: number,
    ) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const startsAt = now + delay;

      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, startsAt);
      gain.gain.setValueAtTime(volume, startsAt);
      gain.gain.exponentialRampToValueAtTime(0.001, startsAt + duration);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(startsAt);
      oscillator.stop(startsAt + duration);
    };

    ring(880, 0.028, 0, 0.18);
    ring(1320, 0.012, 0.012, 0.14);
  }

  function dragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id || team.round1SubmittedAt) return;
    const oldIndex = team.currentOrder.indexOf(String(active.id));
    const newIndex = team.currentOrder.indexOf(String(over.id));
    onTeamPatch({ currentOrder: arrayMove(team.currentOrder, oldIndex, newIndex) });
    playMoveSound();
  }

  function closeHintPopup() {
    if (team.hintSent) localStorage.setItem(seenHintKey, team.hintSent);
    setHintPopupOpen(false);
  }

  function closeWinnerPopup() {
    localStorage.setItem(winnerSeenKey, "true");
    setWinnerPopupOpen(false);
  }

  const hintPopup = hintPopupOpen && team.hintSent && (
    <div className="completion-modal-backdrop" role="presentation">
      <section
        className="completion-modal student-hint-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="student-hint-title"
      >
        <Lightbulb size={52} />
        <h2 id="student-hint-title">💡 선생님의 힌트가 도착했어요!</h2>
        <p>{team.hintSent}</p>
        <button className="primary large" onClick={closeHintPopup}>
          확인
        </button>
      </section>
    </div>
  );

  if (displayPhase === "lobby") {
    return (
      <section className="waiting-room">
        <StudentStageControls floating onPrevious={onBack} onNext={onNext} />
        <span className="character-hero">{character?.emoji}</span>
        <span className="eyebrow">{team.name} · {student.name} 탐정</span>
        <h1>사건 파일이 열리기를 기다리는 중...</h1>
        <p>교사가 ROUND 1을 시작하면 자동으로 화면이 바뀝니다.</p>
        <div className="pulse-dots"><i /><i /><i /></div>
      </section>
    );
  }

  if (displayPhase === "finished") {
    return (
      <section className="result-shell">
        <StudentStageControls floating onPrevious={onBack} onNext={onNext} />
        <span className="eyebrow">수사 결과 보고서</span>
        <WinnerAnnouncement
          winners={winners}
          open={winnerPopupOpen}
          onClose={closeWinnerPopup}
        />
        <div className="result-score">
          <span>{character?.emoji}</span>
          <strong>{team.score}</strong>
          <small>점</small>
        </div>
        <h1>{team.name}, 사건 수고했어요!</h1>
        <div className="badges result-badges">
          {getBadges(
            team,
            reports.filter((report) => report.teamId === team.id),
            teamMemberCount,
          ).map(
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

  if (displayPhase === "round2") {
    return (
      <section className="round-shell">
        {hintPopup}
        <StudentStageControls onPrevious={onBack} onNext={onNext} />
        <RoundHeader round="ROUND 2" title="왜 그렇게 판단했나요?" team={team} student={student} />
        <div className="round2-layout">
          <aside className="panel completed-text">
            <span className="step">모둠 공동 기록</span>
            <h2>완성한 글</h2>
            <p className="completed-text-help">ROUND 1에서 마지막으로 배열한 순서입니다.</p>
            <ol>
              {team.currentOrder.map((sentence) => (
                <li key={sentence}>{sentence}</li>
              ))}
            </ol>
            {team.hintSent && (
              <div className="received-hint persistent-hint">
                <Lightbulb />
                <span><b>받은 힌트</b>{team.hintSent}</span>
              </div>
            )}
          </aside>
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
        </div>
      </section>
    );
  }

  return (
    <section className="round-shell">
      {hintPopup}
      <StudentStageControls onPrevious={onBack} onNext={onNext} />
      <RoundHeader round="ROUND 1" title="사건의 문장을 복원하라" team={team} student={student} />
      <div className="game-layout">
        <div className="card-stage">
          <div className="instruction-row">
            <p><strong>문장을 드래그</strong>해서 올바른 순서로 배열하세요.</p>
            <span><Users size={18} /> 모둠원과 실시간 공유 중</span>
          </div>
          <DndContext sensors={sensors} onDragStart={unlockAudio} onDragEnd={dragEnd}>
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
