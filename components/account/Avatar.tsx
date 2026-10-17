"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Contenuto di un cerchio avatar (D-20): la foto di Google, altrimenti
 * l'iniziale. Il contenitore (dimensione, rotondo, overflow-hidden, colori) e'
 * di chi la usa. La foto la carica il browser direttamente da Google, senza
 * Referer e senza passare dal nostro server: per questo <img> e non
 * next/image, che la farebbe scaricare a noi (e' proprio la scelta di D-20).
 * Un errore di caricamento riporta all'iniziale.
 */
export default function Avatar({ src, initial }: { src: string | null | undefined; initial: string }) {
	const [failed, setFailed] = useState<string | null>(null);
	const ref = useRef<HTMLImageElement>(null);

	// Una pagina renderizzata dal server puo' avere l'errore prima che React
	// agganci onError: lo si recupera a idratazione fatta.
	useEffect(() => {
		const img = ref.current;
		if (img && img.complete && img.naturalWidth === 0) setFailed(src ?? null);
	}, [src]);

	if (!src || failed === src) return <>{initial}</>;
	return (
		<img
			ref={ref}
			src={src}
			alt=""
			referrerPolicy="no-referrer"
			className="h-full w-full object-cover"
			onError={() => setFailed(src)}
		/>
	);
}
