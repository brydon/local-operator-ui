import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";
import {
	COMPANION_DRAG_THRESHOLD,
	type CompanionMood,
} from "../../shared/desktop-companion";
import type { CompanionReaction } from "./companion-art";

type DelightReaction =
	| "happy"
	| "loved"
	| "waking"
	| "landing"
	| "stretching"
	| "yawning"
	| "daydream"
	| "starstruck";

export function useCompanionInteraction(
	mood: CompanionMood = "idle",
	chatOpen = false,
) {
	const [hovered, setHovered] = useState(false);
	const [focused, setFocused] = useState(false);
	const [pressed, setPressed] = useState(false);
	const [dragging, setDragging] = useState<
		"grabbed" | "dragging" | "struggling" | null
	>(null);
	const [dozing, setDozing] = useState(false);
	const [delight, setDelight] = useState<DelightReaction | null>(null);
	const [gaze, setGaze] = useState({ x: 0, y: 0 });
	const origin = useRef<{
		x: number;
		y: number;
		pointerId: number;
		target: HTMLButtonElement;
		moved: boolean;
	} | null>(null);
	const rub = useRef<{
		x: number;
		direction: number;
		turns: number;
		started: number;
	} | null>(null);
	const lastPetAt = useRef(Number.NEGATIVE_INFINITY);
	const lastLovedAt = useRef(Number.NEGATIVE_INFINITY);
	const lastRewardAt = useRef(Number.NEGATIVE_INFINITY);
	const affection = useRef<number[]>([]);
	const taps = useRef({ count: 0, started: 0 });
	const attention = useRef({ hovered: false, focused: false });
	const ambient = useRef(false);
	const reducedMotion = useRef(false);
	const sleeping = useRef(false);
	const chatVisible = useRef(chatOpen);
	const timers = useRef({ idle: 0, hold: 0, reaction: 0 });
	const frame = useRef<number | null>(null);
	const nextGaze = useRef({ x: 0, y: 0 });
	const currentMood = useRef(mood);

	const clear = useCallback((timer: keyof typeof timers.current) => {
		window.clearTimeout(timers.current[timer]);
		timers.current[timer] = 0;
	}, []);
	const cancelFrame = useCallback(() => {
		if (frame.current !== null) cancelAnimationFrame(frame.current);
		frame.current = null;
	}, []);
	const play = useCallback(
		(reaction: DelightReaction, duration: number) => {
			clear("reaction");
			ambient.current =
				reaction === "stretching" ||
				reaction === "yawning" ||
				reaction === "daydream";
			setDelight(reaction);
			timers.current.reaction = window.setTimeout(() => {
				timers.current.reaction = 0;
				ambient.current = false;
				setDelight(null);
			}, duration);
		},
		[clear],
	);
	const cancelAmbient = useCallback(() => {
		if (!ambient.current) return;
		ambient.current = false;
		clear("reaction");
		setDelight(null);
	}, [clear]);
	const wake = useCallback(
		(stretch = true) => {
			clear("idle");
			cancelAmbient();
			if (sleeping.current && stretch) play("waking", 800);
			sleeping.current = false;
			setDozing(false);
			const canRest = () =>
				(currentMood.current === "idle" ||
					currentMood.current === "complete") &&
				!chatVisible.current &&
				!document.hidden;
			if (!canRest()) return;
			const dozeAt = window.performance.now() + 90_000;
			const doze = () => {
				timers.current.idle = 0;
				if (canRest() && !origin.current) {
					sleeping.current = true;
					setDozing(true);
				}
			};
			if (reducedMotion.current) {
				timers.current.idle = window.setTimeout(doze, 90_000);
				return;
			}
			timers.current.idle = window.setTimeout(() => {
				timers.current.idle = 0;
				if (!canRest()) return;
				if (
					!origin.current &&
					!attention.current.hovered &&
					!attention.current.focused &&
					!reducedMotion.current &&
					dozeAt - window.performance.now() >= 2600
				) {
					const hour = new Date().getHours();
					play(
						hour >= 5 && hour <= 10
							? "stretching"
							: hour >= 11 && hour <= 20
								? "daydream"
								: "yawning",
						2600,
					);
				}
				timers.current.idle = window.setTimeout(
					doze,
					Math.max(0, dozeAt - window.performance.now()),
				);
			}, 35_000);
		},
		[cancelAmbient, clear, play],
	);
	const love = useCallback(() => {
		const time = window.performance.now();
		if (time - lastLovedAt.current < 2000) {
			play("happy", 1200);
			return;
		}
		lastLovedAt.current = time;
		if (currentMood.current === "idle" || currentMood.current === "complete") {
			affection.current = affection.current
				.filter((at) => time - at <= 20_000)
				.slice(-3);
			affection.current.push(time);
			if (
				affection.current.length === 4 &&
				time - lastRewardAt.current >= 60_000
			) {
				lastRewardAt.current = time;
				affection.current = [];
				play("starstruck", 1700);
				return;
			}
		}
		play("loved", 1200);
	}, [play]);
	const tap = useCallback(() => {
		wake();
		const time = window.performance.now();
		if (time - taps.current.started > 1000)
			taps.current = { count: 0, started: time };
		if (++taps.current.count >= 3) {
			taps.current.count = 0;
			love();
		} else play("happy", 1200);
	}, [love, play, wake]);
	const cleanup = useCallback(() => {
		clear("idle");
		clear("hold");
		clear("reaction");
		cancelFrame();
		const gesture = origin.current;
		origin.current = null;
		rub.current = null;
		taps.current.count = 0;
		affection.current = [];
		attention.current = { hovered: false, focused: false };
		ambient.current = false;
		sleeping.current = false;
		if (gesture?.target.hasPointerCapture(gesture.pointerId))
			gesture.target.releasePointerCapture(gesture.pointerId);
	}, [cancelFrame, clear]);
	const reset = useCallback(() => {
		cleanup();
		setPressed(false);
		setDragging(null);
		setDelight(null);
		setDozing(false);
		setHovered(false);
		setFocused(false);
		setGaze({ x: 0, y: 0 });
		if (!document.hidden) wake(false);
	}, [cleanup, wake]);

	function pet(event: PointerEvent<HTMLButtonElement>) {
		const bounds = event.currentTarget.getBoundingClientRect();
		const time = window.performance.now();
		if (
			origin.current ||
			(currentMood.current !== "idle" && currentMood.current !== "complete") ||
			event.pointerType === "touch" ||
			event.clientY > bounds.top + bounds.height * 0.6
		) {
			rub.current = null;
			return;
		}
		if (time - lastPetAt.current < 1800) return;
		const stroke = rub.current;
		if (!stroke || time - stroke.started > 1200) {
			rub.current = { x: event.screenX, direction: 0, turns: 0, started: time };
			return;
		}
		const delta = event.screenX - stroke.x;
		if (Math.abs(delta) < 10) return;
		const direction = Math.sign(delta);
		if (stroke.direction && direction !== stroke.direction) stroke.turns++;
		stroke.direction = direction;
		stroke.x = event.screenX;
		if (stroke.turns >= 3) {
			lastPetAt.current = time;
			rub.current = null;
			love();
		}
	}

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
		const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
		const sync = () => {
			reducedMotion.current = preference.matches;
			if (preference.matches) cancelAmbient();
		};
		sync();
		preference.addEventListener("change", sync);
		return () => preference.removeEventListener("change", sync);
	}, [cancelAmbient]);
	useEffect(() => {
		currentMood.current = mood;
		chatVisible.current = chatOpen;
		rub.current = null;
		wake(chatOpen);
		return () => clear("idle");
	}, [mood, chatOpen, wake, clear]);
	useEffect(() => {
		const visibility = () => (document.hidden ? reset() : wake());
		const focus = () => wake();
		window.addEventListener("blur", reset);
		window.addEventListener("focus", focus);
		document.addEventListener("visibilitychange", visibility);
		return () => {
			window.removeEventListener("blur", reset);
			window.removeEventListener("focus", focus);
			document.removeEventListener("visibilitychange", visibility);
			cleanup();
		};
	}, [cleanup, reset, wake]);

	const reaction: CompanionReaction =
		dragging ??
		delight ??
		(pressed
			? "pressed"
			: dozing && (mood === "idle" || mood === "complete")
				? "dozing"
				: hovered || focused
					? "curious"
					: "rest");
	return {
		reaction,
		gaze,
		tap,
		wake,
		reset,
		isEngaged: hovered || focused || pressed || dragging !== null,
		handlers: {
			onFocus: () => {
				attention.current.focused = true;
				wake();
				setFocused(true);
			},
			onBlur: reset,
			onPointerEnter: (event: PointerEvent<HTMLButtonElement>) => {
				wake();
				if (event.pointerType !== "touch") {
					attention.current.hovered = true;
					setHovered(true);
				}
				look(event);
			},
			onPointerLeave: () => {
				rub.current = null;
				attention.current.hovered = false;
				setHovered(false);
				cancelFrame();
				if (!origin.current) setGaze({ x: 0, y: 0 });
			},
			onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
				if (
					event.button !== 0 ||
					event.ctrlKey ||
					event.isPrimary === false ||
					origin.current
				)
					return;
				wake();
				clear("reaction");
				setDelight(null);
				origin.current = {
					x: event.screenX,
					y: event.screenY,
					pointerId: event.pointerId,
					target: event.currentTarget,
					moved: false,
				};
				setPressed(true);
				look(event);
				timers.current.hold = window.setTimeout(() => {
					timers.current.hold = 0;
					if (origin.current && !origin.current.moved) setDelight("happy");
				}, 450);
			},
			onPointerMove: (event: PointerEvent<HTMLButtonElement>) => {
				if (
					event.isPrimary === false ||
					(origin.current && origin.current.pointerId !== event.pointerId)
				)
					return;
				wake();
				look(event);
				pet(event);
				if (
					origin.current &&
					!origin.current.moved &&
					Math.hypot(
						event.screenX - origin.current.x,
						event.screenY - origin.current.y,
					) > COMPANION_DRAG_THRESHOLD
				) {
					const gesture = origin.current;
					gesture.moved = true;
					taps.current.count = 0;
					clear("hold");
					setDelight(null);
					setDragging("grabbed");
					timers.current.hold = window.setTimeout(() => {
						timers.current.hold = 0;
						if (origin.current !== gesture) return;
						setDragging("dragging");
						timers.current.hold = window.setTimeout(() => {
							timers.current.hold = 0;
							if (origin.current === gesture) setDragging("struggling");
						}, 950);
					}, 250);
				}
			},
			onPointerUp: (
				event?: PointerEvent<HTMLButtonElement>,
			): "tap" | "drag" | null => {
				const gesture = origin.current;
				if (
					!gesture ||
					(event &&
						(event.button !== 0 || event.pointerId !== gesture.pointerId))
				)
					return null;
				origin.current = null;
				clear("hold");
				setPressed(false);
				setDragging(null);
				if (gesture.moved) {
					wake();
					play("landing", 900);
				} else tap();
				return gesture.moved ? "drag" : "tap";
			},
			onLostPointerCapture: () => {
				if (origin.current) reset();
			},
			onPointerCancel: reset,
		},
	};
}
