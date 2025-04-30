import { useEffect, useRef } from "react";

/**
 *  ImprovedLiveTranscription  –  head-less recorder
 *  ------------------------------------------------
 *  • active=true  →  打开麦克风、连 WS，实时把文本 / 结构化摘要回传给父组件
 *  • active=false → 立即释放所有资源
 *
 *  props:
 *    active              boolean   // 开启 / 关闭
 *    onTranscriptUpdate  (string)=>void
 *    onSummaryUpdate     (jsonStr)=>void
 */
export default function ImprovedLiveTranscription({
    active,
    onTranscriptUpdate,
    onSummaryUpdate,
}) {
    /* refs 用来保存实例 —— 方便随时关闭 */
    const wsRef = useRef(null);
    const ctxRef = useRef(null);
    const streamRef = useRef(null);
    const nodeRef = useRef(null);

    /* 统一清理函数 */
    const stopAll = () => {
        nodeRef.current?.disconnect();
        nodeRef.current = null;

        ctxRef.current &&
            ctxRef.current.state !== "closed" &&
            ctxRef.current.close();
        ctxRef.current = null;

        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;

        wsRef.current?.readyState === WebSocket.OPEN && wsRef.current.close();
        wsRef.current = null;
    };

    /* 主副作用：active ↔︎ 录音 */
    useEffect(() => {
        if (!active) {
            stopAll();
            return;
        }

        (async () => {
            try {
                /* 1️⃣ 麦克风流 */
                const stream = await navigator.mediaDevices.getUserMedia({
                    audio: { sampleRate: 16000, channelCount: 1 },
                });
                streamRef.current = stream;

                /* 2️⃣ WebSocket */
                const proto = location.protocol === "https:" ? "wss:" : "ws:";
                const host =
                    location.hostname === "localhost" ? "localhost:8000" : location.host;
                const ws = new WebSocket(`${proto}//${host}/ws/transcribe`);
                wsRef.current = ws;

                ws.onmessage = (e) => {
                    let data;
                    try {
                        data = JSON.parse(e.data);
                    } catch {
                        return;
                    }

                    if (data.type === "final" && data.text) {
                        onTranscriptUpdate?.(data.text);   // 每次仅发送最新一句
                    }
                    if (data.structured_summary) {
                        onSummaryUpdate?.(data.structured_summary);
                    }
                };

                ws.onopen = async () => {
                    /* 3️⃣ AudioContext + worklet / fallback */
                    const ctx = new (window.AudioContext ||
                        window.webkitAudioContext)({ sampleRate: 16000 });
                    ctxRef.current = ctx;

                    let node;
                    try {
                        await ctx.audioWorklet.addModule("audio-processor.js"); // 自己的 worklet
                        node = new AudioWorkletNode(ctx, "transcription-processor");
                        node.port.postMessage({
                            type: "config",
                            bufferSize: 2048,
                            silenceThreshold: 0.01,
                        });
                        node.port.onmessage = (ev) => {
                            if (ev.data.type === "audio" && ws.readyState === ws.OPEN) {
                                ws.send(ev.data.data);
                            }
                        };
                    } catch {
                        // fallback to ScriptProcessor
                        const bufferSize = 2048;
                        node = ctx.createScriptProcessor(bufferSize, 1, 1);
                        node.onaudioprocess = (ev) => {
                            if (ws.readyState !== ws.OPEN) return;
                            const input = ev.inputBuffer.getChannelData(0);
                            const int16 = new Int16Array(input.length);
                            for (let i = 0; i < input.length; i++) {
                                int16[i] = Math.max(-1, Math.min(1, input[i])) * 0x7fff;
                            }
                            ws.send(int16.buffer);
                        };
                    }

                    nodeRef.current = node;
                    ctx.createMediaStreamSource(stream).connect(node);
                    node.connect(ctx.destination);
                };

                ws.onerror = stopAll;
                ws.onclose = stopAll;
            } catch (err) {
                console.error("LiveTranscription error:", err);
                stopAll();
            }
        })();

        return stopAll; // 清理
    }, [active]);

    return null; // 不渲染任何界面
}
