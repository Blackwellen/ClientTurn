import { STAGES } from "./constants/stages";

export function HeroFallback() {
  return <div className="conversion-fallback"><ol>{STAGES.map((stage, index) => <li key={stage.title}><span>0{index + 1}</span><strong>{stage.title}</strong></li>)}</ol><p>One connected journey, from enquiry to outcome.</p></div>;
}
