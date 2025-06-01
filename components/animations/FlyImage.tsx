"use client"

import { useSpring, animated } from "@react-spring/web"
import { useEffect } from "react"

interface FlyImageProps {
    src: string
    from: { x: number; y: number }
    to: { x: number; y: number }
    onDone?: () => void
}

export function FlyImage({ src, from, to, onDone }: FlyImageProps) {
    const [styles, api] = useSpring(() => ({
        from: {
            left: from.x,
            top: from.y,
            scale: 1,
            opacity: 1,
        },
        config: { duration: 500 },
    }))

    useEffect(() => {
        api.start({
            left: to.x,
            top: to.y,
            scale: 0.1,
            opacity: 0,
            onRest: onDone,
        })
    }, [to.x, to.y])

    return (
        <animated.img
            src={src}
            style={{
                position: "fixed",
                width: 80,
                height: 80,
                zIndex: 9999,
                borderRadius: 8,
                pointerEvents: "none",
                ...styles,
            }}
        />
    )
}
