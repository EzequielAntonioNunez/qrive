import { useEffect, useState } from 'react';
import { useRive, useStateMachineInput } from '@rive-app/react-webgl2';

const dialogue: Record<string, string> = {
  prepare: 'Gracias por venir. Nuestros costes han subido y necesitamos revisar el precio. Si encontramos una propuesta equilibrada, podremos seguir trabajando juntos.',
  counteroffer: 'Podría reducir la subida si acordamos tres años de colaboración. Necesito saber qué garantías y compromisos estaríais dispuestos a aceptar.',
  close: 'Estamos cerca de un acuerdo. Para cerrarlo hoy, necesito una decisión final y una forma clara de comprobar que cumplimos los compromisos.'
};

export function AvatarStage({ phaseId, paused }: { phaseId: string; paused: boolean }) {
  const [speaking, setSpeaking] = useState(false);
  const [voiceError, setVoiceError] = useState('');
  const { rive, RiveComponent } = useRive({ src: '/avatar.riv', stateMachines: 'Avatar', autoplay: true });
  const speakingInput = useStateMachineInput(rive, 'Avatar', 'speaking', false);
  const line = dialogue[phaseId] ?? dialogue.prepare;

  useEffect(() => { if (speakingInput) speakingInput.value = speaking; }, [speaking, speakingInput]);
  useEffect(() => {
    window.speechSynthesis?.cancel();
    setSpeaking(false);
    return () => { window.speechSynthesis?.cancel(); };
  }, [phaseId]);
  useEffect(() => {
    if (paused && speaking) {
      window.speechSynthesis?.cancel();
      setSpeaking(false);
    }
  }, [paused, speaking]);

  function toggleVoice() {
    if (!('speechSynthesis' in window)) { setVoiceError('Este navegador no dispone de voz.'); return; }
    if (speaking) { window.speechSynthesis.cancel(); setSpeaking(false); return; }
    setVoiceError('');
    const utterance = new SpeechSynthesisUtterance(line);
    utterance.lang = 'es-ES';
    utterance.rate = 0.92;
    utterance.pitch = 1.04;
    const spanishVoice = window.speechSynthesis.getVoices().find(voice => voice.lang.toLowerCase().startsWith('es'));
    if (spanishVoice) utterance.voice = spanishVoice;
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => { setSpeaking(false); setVoiceError('No se pudo reproducir la voz.'); };
    window.speechSynthesis.speak(utterance);
  }

  return <div className={`avatar-stage ${speaking ? 'is-speaking' : ''}`}>
    <div className="avatar-art" aria-label="Elena, representante del proveedor"><RiveComponent/></div>
    <div className="avatar-copy">
      <span className="avatar-kicker"><i/> INTERLOCUTORA · PROVEEDOR ESTRATÉGICO</span>
      <h3>Elena Vega</h3>
      <blockquote>“{line}”</blockquote>
      <button type="button" className="voice-button" onClick={toggleVoice} disabled={paused}>{speaking ? '■ Detener voz' : '▶ Escuchar intervención'}</button>
      {voiceError && <small role="alert">{voiceError}</small>}
    </div>
  </div>;
}
