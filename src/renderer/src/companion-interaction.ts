import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";

import type { CompanionReaction } from "./companion-art";

export function useCompanionInteraction() {
	const [hovered, setHovered] = useState(false);
	const [focused, setFocused] = useState(false);
	const [pressed, setPressed] = useState(false);
	const [dragging, setDragging] = useState(false);
	const [gaze, setGaze] = useState({ x: 0, y: 0 });
	const origin = useRef<{ x: number; y: number } | null>(null);
	const frame = useRef<number | null>(null);
	const nextGaze = useRef({ x: 0, y: 0 });

	const cancelFrame = useCallback(() => {
		if (frame.current !== null) cancelAnimationFrame(frame.current);
		frame.current = null;
	}, []);
	const release = useCallback(() => {
		origin.current = null;
		setPressed(false);
		setDragging(false);
	}, []);
	const reset = useCallback(() => {
		cancelFrame();
		release();
		setHovered(false);
		setFocused(false);
		setGaze({ x: 0, y: 0 });
	}, [cancelFrame, release]);
	function look(event: PointerEvent<HTMLButtonElement>) {
		if (event.pointerType === "touch") return;
		const bounds = event.currentTarget.getBoundingClientRect();
		if (!bounds.width || !bounds.height) return;
		nextGaze.current = {
			x: Math.max(
				-1,
				Math.min(1, ((event.clientX - bounds.left) / bounds.width) * 2 - 1),
			),
			y: Math.max(
				-1,
				Math.min(1, ((event.clientY - bounds.top) / bounds.height) * 2 - 1),
			),
		};
		if (frame.current === null)
			frame.current = requestAnimationFrame(() => {
				frame.current = null;
				setGaze(nextGaze.current);
			});
	}

	useEffect(() => {
		const visibility = () => {
			if (document.hidden) reset();
		};
		window.addEventListener("blur", reset);
		document.addEventListener("visibilitychange", visibility);
		return () => {
			cancelFrame();
			window.removeEventListener("blur", reset);
			document.removeEventListener("visibilitychange", visibility);
		};
	}, [cancelFrame, reset]);

	const reaction: CompanionReaction = dragging
		? "dragging"
		: pressed
			? "pressed"
			: hovered || focused
				? "curious"
				: "rest";
	return {
		reaction,
		gaze,
		reset,
		handlers: {
			onFocus: () => setFocused(true),
			onBlur: () => setFocused(false),
			onPointerEnter: (event: PointerEvent<HTMLButtonElement>) => {
				if (event.pointerType !== "touch") setHovered(true);
				look(event);
			},
			onPointerLeave: () => {
				setHovered(false);
				cancelFrame();
				if (!origin.current) setGaze({ x: 0, y: 0 });
			},
			onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
				if (event.button !== 0 || event.ctrlKey || event.isPrimary === false)
					return;
				origin.current = { x: event.screenX, y: event.screenY };
				setPressed(true);
				look(event);
			},
			onPointerMove: (event: PointerEvent<HTMLButtonElement>) => {
				look(event);
				if (
					origin.current &&
					Math.hypot(
						event.screenX - origin.current.x,
						event.screenY - origin.current.y,
					) > 4
				)
					setDragging(true);
			},
			onPointerUp: release,
			onLostPointerCapture: release,
			onPointerCancel: reset,
		},
	};
}
