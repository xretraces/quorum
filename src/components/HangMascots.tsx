/** Original mascot trio — flat, chunky, Duo/Kahoot-inspired pictograms. UI only. */
export function HangMascots({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 320 140" className={className} aria-hidden="true">
      {/* ground shadows */}
      <ellipse cx="60" cy="130" rx="30" ry="6" fill="#164e72" opacity="0.18" />
      <ellipse cx="160" cy="132" rx="40" ry="7" fill="#164e72" opacity="0.18" />
      <ellipse cx="256" cy="130" rx="28" ry="6" fill="#164e72" opacity="0.18" />

      {/* left buddy — navy blob, leaning in */}
      <ellipse cx="44" cy="124" rx="10" ry="6" fill="#ffd000" />
      <ellipse cx="72" cy="124" rx="10" ry="6" fill="#ffd000" />
      <rect x="24" y="52" width="72" height="70" rx="34" fill="#164e72" />
      <path d="M92 90 Q108 92 116 82" fill="none" stroke="#164e72" strokeWidth="10" strokeLinecap="round" />
      <circle cx="48" cy="82" r="9" fill="#fff" />
      <circle cx="72" cy="82" r="9" fill="#fff" />
      <circle cx="50" cy="84" r="4" fill="#164e72" />
      <circle cx="74" cy="84" r="4" fill="#164e72" />
      <path d="M53 97 Q60 103 67 97" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" />

      {/* middle buddy — white, cheering */}
      <path d="M118 66 Q104 54 102 40" fill="none" stroke="#164e72" strokeWidth="10" strokeLinecap="round" />
      <path d="M202 66 Q216 54 218 40" fill="none" stroke="#164e72" strokeWidth="10" strokeLinecap="round" />
      <circle cx="102" cy="36" r="9" fill="#fff" stroke="#164e72" strokeWidth="6" />
      <circle cx="218" cy="36" r="9" fill="#fff" stroke="#164e72" strokeWidth="6" />
      <rect x="112" y="32" width="96" height="94" rx="44" fill="#fff" stroke="#164e72" strokeWidth="6" />
      <circle cx="146" cy="74" r="5" fill="#164e72" />
      <circle cx="174" cy="74" r="5" fill="#164e72" />
      <circle cx="136" cy="86" r="5" fill="#9ad6f4" opacity="0.9" />
      <circle cx="184" cy="86" r="5" fill="#9ad6f4" opacity="0.9" />
      <path d="M148 88 Q160 99 172 88" fill="none" stroke="#164e72" strokeWidth="4" strokeLinecap="round" />
      <ellipse cx="142" cy="126" rx="11" ry="6" fill="#164e72" />
      <ellipse cx="178" cy="126" rx="11" ry="6" fill="#164e72" />

      {/* right buddy — little sun-yellow blob, waving */}
      <path d="M286 80 Q298 70 296 56" fill="none" stroke="#164e72" strokeWidth="9" strokeLinecap="round" />
      <circle cx="296" cy="50" r="8" fill="#164e72" />
      <ellipse cx="256" cy="88" rx="34" ry="38" fill="#ffd000" stroke="#164e72" strokeWidth="6" />
      <circle cx="246" cy="82" r="4.5" fill="#164e72" />
      <circle cx="266" cy="82" r="4.5" fill="#164e72" />
      <path d="M248 94 Q256 100 264 94" fill="none" stroke="#164e72" strokeWidth="3.5" strokeLinecap="round" />

      {/* tiny accents */}
      <circle cx="14" cy="44" r="4" fill="#fff" opacity="0.9" />
      <path d="M304 100 h12 M310 94 v12" stroke="#fff" strokeWidth="4" strokeLinecap="round" opacity="0.9" />
    </svg>
  );
}
