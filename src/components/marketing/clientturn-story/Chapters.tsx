import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Group } from "three";
import { Card, Branch, Reveal, Transfer, Status, Calendar, MiniRows, ScanField, type ChapterProps } from "./StoryObjects";
import { Lettering, Shell, Halo, HubFloor } from "../hero/scene/primitives";
import { useMaterials } from "../hero/scene/materials";
import { PALETTE, type Point3 } from "../hero/constants/stages";
import { PrecisionBox } from "../hero/scene/PrecisionBox";
import { localProgress, clamp } from "./stages";

/** Verdicts carry their own colour through card, edge and outgoing route. Green healthy, amber warning, red action required. */
/** The four configured questions, with the glyph each one carries on the reference board. */
const RULES = [
  { title: "Service Area", icon: "globe" },
  { title: "Budget", icon: "wallet" },
  { title: "Timing", icon: "clock" },
  { title: "Requirements", icon: "list" },
] as const;

const OUTCOMES = [
  { title: "QUALIFIED", colour: PALETTE.lime, icon: "person", tone: "lime" },
  { title: "REVIEW", colour: "#E9B44C", icon: "clock", tone: "amber" },
  { title: "NOT A FIT", colour: "#D9636A", icon: "cross", tone: "danger" },
] as const;

export function SpeedToLead(props: ChapterProps) {
  const waiting = useRef<Group>(null);
  useFrame(() => { if (waiting.current) {
    const p = props.staticMode ? 0.7 : localProgress(props.progress.get(), props.index);
    waiting.current.position.set(1.6, 1.4 + p * 0.55, -0.5 - p * 1.1);
    waiting.current.rotation.y = p * 0.25;
  } });
  return <>
    <Reveal {...props} position={[-2.5, 0, 0]}><Card title="New enquiry" subtitle="Meta lead form" height={1.1} icon="envelope" active /></Reveal>
    <Branch points={[[-1.5, 0, 0], [-0.4, 0.15, -0.15], [0.3, 1.25, -0.4], [1.2, 1.45, -0.5]]} active={false} />
    <group ref={waiting} position={[1.6, 1.4, -0.5]}><Card title="Waiting" position={[0.12, 0.16, -0.24]} icon="clock" /><Card title="Waiting" icon="clock" /></group>
    <Reveal {...props} position={[1.6, -0.9, 0.3]} start={0.3}><Card title="Response sent" subtitle="Conversation started" height={1.1} width={2.6} icon="send" active /><Status {...props} position={[1.1, -0.25, 0.16]} start={0.4} /></Reveal>
  </>;
}

export function FollowUp(props: ChapterProps) {
  const future = useRef<Group>(null);
  useFrame(() => { if (future.current) future.current.position.z = -clamp((localProgress(props.progress.get(), props.index) - 0.55) * 3) * 0.65; });
  return <>
    {["Immediately", "+10 min", "+2 hours"].map((title, i) => <Reveal key={title} {...props} position={[-0.85 + Math.sin(i * 0.9) * 0.3, 1.6 - i * 0.9, -0.6 + i * 0.55]} start={i * 0.15} end={0.2 + i * 0.15}><Card title={title} width={2.1} height={0.57} active icon={i === 0 ? "clock" : "message"} /><Status {...props} position={[0.81, 0, 0.15]} start={0.15 + i * 0.15} /></Reveal>)}
    <group ref={future}>{["+1 day", "+3 days"].map((title, i) => <Card key={title} title={title} position={[-0.7 + i * 0.22, -1.08 - i * 0.82, -0.12]} width={2.1} height={0.55} icon="clock" />)}</group>
    <Transfer {...props} path={[[3.5,0.9,-1.5],[2.6,0.1,0.6],[1.78,-0.55,1.2]]} start={0.45} end={0.78}><Card title="Reply received" subtitle="Follow-up stopped" height={1.05} width={2.05} icon="reply" active /></Transfer>
    {["Replied", "Booked", "Won", "Opted Out", "Human Takeover"].map((text, i) => <Card key={text} title={text} position={[-2.28 + i * 1.14, -3.15, -0.5]} width={1.06} height={0.36} icon="none" active={i === 0} />)}
  </>;
}

export function Qualification(props: ChapterProps) {
  return <>
    <Transfer {...props} path={[[-4.1,0.3,0],[-3.4,0,0.5],[-2.25,0,-0.62]]} start={0.08} end={0.55}><Card title="New enquiry" width={1.65} icon="person" /></Transfer>
    <Shell width={2.3} height={2.8} depth={0.34} />
    {RULES.map(({ title, icon }, i) => <Reveal key={title} {...props} position={[0, 0.95 - i * 0.63, 0.22]} start={0.1 + i * 0.12} end={0.25 + i * 0.12}><Card title={title} width={2.08} height={0.5} icon={icon} iconTone="white" /><Status {...props} position={[0.82, 0, 0.16]} start={0.1 + i * 0.12} /></Reveal>)}
    {OUTCOMES.map((outcome, i) => <group key={outcome.title}>
      <Branch offset={-0.12} points={[[1.14, (1 - i) * 0.1, -0.05], [1.52, (1 - i) * 0.52, -0.02], [1.82, (1 - i) * 0.9, i === 0 ? 0.14 : -0.42]]} active={i === 0} color={outcome.colour} dim={i !== 0} />
      <Reveal {...props} position={[2.5, (1 - i) * 0.9, i === 0 ? 0.2 : -0.62]} start={0.55} end={0.8}><Card title={outcome.title} width={1.62} height={0.66} icon={outcome.icon} active={i === 0} color={outcome.colour} edge={outcome.colour} iconTone={outcome.tone} titleColor={outcome.colour} /></Reveal>
    </group>)}
  </>;
}

export function Booking(props: ChapterProps) {
  return <>
    <Card title="Qualified Lead" position={[-1.95, 0, 0]} width={1.7} height={1.6} icon="person" active />
    <Calendar {...props} position={[0.6, 0.65, 0.15]} />
    <Reveal {...props} position={[2.3, 0.1, 0.05]} start={0.45} end={0.7}><Card title="Booking Confirmed" width={2.05} height={1.2} icon="calendar" active><Status {...props} position={[0, -0.23, 0.17]} start={0.5} /></Card></Reveal>
    <Branch points={[[-1.35, -0.4, 0], [-0.85, -0.85, -0.05], [-0.6, -1.7, 0.05], [-0.7, -1.95, 0.15]]} active={false} />
    <Card title="Needs Attention" position={[0.5, -1.78, 0.15]} width={2.4} icon="person" />
    <Lettering text="ROUTE B · HUMAN HANDOVER" position={[0.5, -2.42, 0.15]} width={2.5} height={0.17} color="#bfa468" align="center" />
    <Lettering text="ROUTE A · BOOKING" position={[-1.62, 1.28, 0.75]} width={1.75} height={0.17} color={PALETTE.lime} align="center" />
    <Card title="Calendly" subtitle="Connected" position={[-2.85, -1.35, -0.3]} width={1.6} height={0.8} icon="calendar" />
    <Card title="Google Calendar" subtitle="Connected" position={[-2.85, -2.3, -0.3]} width={1.6} height={0.8} icon="calendar" />
  </>;
}

export function Reactivation(props: ChapterProps) {
  const scan = useRef<Group>(null);
  const eligible = useRef<Group>(null);
  useFrame(() => {
    const p = props.staticMode ? 0.8 : localProgress(props.progress.get(), props.index);
    if (eligible.current) {
      const lift = clamp((p - 0.2) / 0.35);
      const travel = clamp((p - 0.55) / 0.4);
      const eased = travel * travel * (3 - 2 * travel);
      eligible.current.position.set(0.4 + eased * 2.6, lift * 1.2 - eased * 1.4, 0.5 + Math.sin(eased * Math.PI) * 0.9 - eased * 1.2);
      eligible.current.rotation.y = -0.2 + eased * 0.3;
      eligible.current.scale.setScalar(1 - eased * 0.18);
    }
  });
  return <>
    {["No Reply", "Not Booked", "Older Enquiry"].map((title, i) => <group key={title} position={[-2.4 + i * 1.4, 0, 0]}>{[3, 2, 1, 0].map(j => <Card key={j} title={title} position={[-j * 0.045, j * 0.09, -j * 0.62]} width={1.17} height={1.65} icon="none"><group scale={0.72}><MiniRows count={3} /></group></Card>)}</group>)}
    <group ref={scan}><ScanField {...props} /></group>
    <group ref={eligible}><Card title="Eligible enquiry" width={1.4} height={1.8} icon="none" active><MiniRows count={3} /></Card></group>
    <Reveal {...props} position={[1.95, -0.16, 0.35]} start={0.65} end={0.85}><Card title="Reply forwarded" subtitle="Back in conversation" width={1.72} height={1.1} active icon="reply" /></Reveal>
    {["Opted Out", "Already Booked", "Active Conversation"].map((title, i) => <group key={title}><Card title={title} position={[-2.4 + i * 1.5, -1.95, -0.35]} width={1.38} height={0.4} icon="none" /><Lettering text="SUPPRESSED" position={[-2.4 + i * 1.5, -2.32, -0.35]} width={0.86} height={0.11} color="#5f6b7d" align="center" /></group>)}
  </>;
}

/** Module placement, hub port and spoke route in one table: every wire below corresponds to a real information flow. */
const CONTROL_MODULES = ["Lead List", "Conversation", "Qualification", "Booking", "Needs Attention", "Integration Health", "Funnel / Status"].map((title, i) => {
  const top = i < 5;
  const x = top ? -3.35 + i * 1.68 : -1.75 + (i - 5) * 3.5;
  const y = top ? 0.6 + Math.sin(i / 4 * Math.PI) * 0.5 : -1.5;
  /* Outer modules sit further back so the arc reads as foreground, midground and background. */
  const z = top ? -1.15 + Math.abs(i - 2) * -0.42 + 0.9 : 1.05;
  return { title, index: i, top, x, y, z, width: top ? 1.5 : 2.6, height: top ? 2.15 : 1.4 };
});
const HUB: Point3 = [0, -0.9, 0.55];

export function Control(props: ChapterProps) {
  const materials = useMaterials();
  return <>
    {CONTROL_MODULES.map(module => <Branch key={module.title} offset={0}
      points={[HUB, [HUB[0] + (module.x - HUB[0]) * 0.42, HUB[1] + 0.12, HUB[2] + (module.z - HUB[2]) * 0.42], [module.x * 0.86, module.y - module.height / 2 - (module.top ? 0.55 : 0.28), module.z + 0.18], [module.x, module.y - module.height / 2 - 0.03, module.z]]}
      active={false} dim color={PALETTE.lime} />)}
    {CONTROL_MODULES.map(module => <Reveal key={module.title} {...props} position={[module.x, module.y, module.z]} start={module.index * 0.05} end={0.5 + module.index * 0.05}><group rotation-y={module.top ? (2 - module.index) * 0.14 : (5.5 - module.index) * 0.15}><Card title={module.title} width={module.width} height={module.height} icon="none"><ControlContent index={module.index} /></Card></group></Reveal>)}
    <HubFloor position={[HUB[0], HUB[1] - 1.15, HUB[2]]} radius={4.7} />
    {[1.35, 2.35, 3.5].map(radius => <mesh key={radius} position={[HUB[0], HUB[1] - 1.14, HUB[2]]} rotation-x={-Math.PI / 2}><ringGeometry args={[radius - 0.01, radius, 96]} /><meshBasicMaterial color="#B7F34A" transparent opacity={0.11} depthWrite={false} toneMapped={false} /></mesh>)}
    <group position={HUB}>
      <mesh material={materials.shell} castShadow receiveShadow><cylinderGeometry args={[0.49, 0.56, 0.18, 96]} /></mesh>
      <mesh position-y={0.11} rotation-x={Math.PI / 2} material={materials.lime}><torusGeometry args={[0.41, 0.025, 16, 96]} /></mesh>
      <mesh position-y={0.12} scale={[1,0.22,1]} material={materials.glass}><sphereGeometry args={[0.35,48,32]} /></mesh>
      <mesh position-y={0.13} rotation-x={Math.PI / 2} material={materials.lime}><circleGeometry args={[0.13,48]} /></mesh>
      <group position-y={0.09} rotation-x={-Math.PI / 2}><Halo scale={3.4} /></group>
    </group>
  </>;
}

function ControlContent({ index }: { index: number }) {
  const materials = useMaterials();
  if (index === 1) return <group position-z={0.16}>
    {[-0.1, -0.47, 0.28].map((y, i) => <PrecisionBox key={y} args={[0.92, 0.23, 0.04]} position={[i === 1 ? 0.12 : -0.12, y, 0]} radius={0.06} material={i === 1 ? materials.lime : materials.edge} />)}
  </group>;
  if (index === 2) return <group>{["Service Area", "Budget", "Timing", "Requirements"].map((text, i) => <group key={text}><Lettering text={text} position={[-0.06, 0.25 - i * 0.29, 0.16]} width={1.1} height={0.14} /><mesh position={[0.54, 0.25 - i * 0.29, 0.16]} material={materials.lime}><circleGeometry args={[0.035, 16]} /></mesh></group>)}</group>;
  if (index === 3) return <group>{Array.from({ length: 28 }, (_, i) => <mesh key={i} position={[-0.48 + i % 7 * 0.16, 0.35 - Math.floor(i / 7) * 0.23, 0.16]} material={i === 17 ? materials.lime : materials.muted}><circleGeometry args={[i === 17 ? 0.052 : 0.023, 16]} /></mesh>)}</group>;
  if (index === 4) return <group><MiniRows count={1} /><mesh position={[0.55, 0.22, 0.17]}><circleGeometry args={[0.05, 16]} /><meshBasicMaterial color="#d98173" /></mesh><Lettering text="Review required" position={[0, -0.3, 0.15]} width={1.1} height={0.17} color="#b5bdcc" /></group>;
  if (index === 5) return <group>{["Calendly", "Google Calendar"].map((title, i) => <group key={title}><Lettering text={title} position={[-0.4, 0.02 - i * 0.36, 0.16]} width={1.25} height={0.18} /><Lettering text="Connected" position={[0.77, 0.02 - i * 0.36, 0.16]} width={0.7} height={0.14} color={PALETTE.lime} /></group>)}</group>;
  if (index === 6) return <group><Branch points={[[-0.95, -0.13, 0.16], [0, -0.13, 0.16], [0.95, -0.13, 0.16]]} />{["Leads", "Replies", "Qualified", "Bookings"].map((text, i) => <group key={text}><Lettering text={text} position={[-0.89 + i * 0.6, 0.1, 0.17]} width={0.55} height={0.13} /><mesh position={[-0.92 + i * 0.6, -0.13, 0.18]} material={materials.lime}><sphereGeometry args={[0.047, 16, 12]} /></mesh></group>)}</group>;
  return <MiniRows count={4} />;
}
