import React, { useState, useRef, useEffect } from "react";
import ReactQuill from "react-quill";
import Delta from "quill-delta";
import "react-quill/dist/quill.snow.css";

import AudioTranscription from "./components/AudioTranscription";
import PPTUpload from "./components/PPTUpload2";
import ImprovedLiveTranscription from "./components/ImprovedLiveTranscription";
import ReactMarkdown from "react-markdown";
import "./App.css";

/* ---------- helpers ---------- */
const TYPE_SPEED = 20;
const toDelta = (map) => {
    const ops = [];
    Array.from(map.values())
        .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
        .forEach(s => ops.push({ insert: `${s.id} ${s.title}\n${s.content}\n\n` }));
    return new Delta(ops);
};

export default function App() {
    const quillRef = useRef(null);
    const pptRef = useRef(null);
    const transRef = useRef(null);

    const [summaryMap, setSummaryMap] = useState(new Map());
    const [transcript, setTranscript] = useState("");
    const [pptOutline, setPptOutline] = useState("");
    const [nextMd, setNextMd] = useState("");
    const [live, setLive] = useState(false);
    const [showAudio, setShowAudio] = useState(false);
    const [structuredJson, setStructuredJson] = useState("{}");

    /* ---------- pull next-topic prompt ---------- */
    useEffect(() => {
        // if (!pptOutline) return;

        const recent = transcript.split("\n").slice(-10).join("\n");

        const body = new URLSearchParams({
            structured_summary: structuredJson,   // ⭐ 新字段
            recent_transcript: recent,
            presentation_outline: pptOutline || ""
        });

        /* ⭐ ② 把变量传进 fetch */
        fetch("http://localhost:8000/next-topic-prompt", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body
        })
            .then(r => r.json())
            .then(d => {
                setNextMd(d.markdown || "");
                if (typeof d.next_pointer === "number") setNextPointer(d.next_pointer);
            })
            .catch(console.error);
    }, [pptOutline, transcript, structuredJson]);


    /* 加粗标题滚动到底部 */
    useEffect(() => { transRef.current && (transRef.current.scrollTop = transRef.current.scrollHeight); }, [transcript]);

    /* 初始空 quill */
    useEffect(() => { quillRef.current?.getEditor().setContents([]); }, []);

    /* 追加转写 */
    const appendTranscript = (txt) =>
        setTranscript(prev => prev.endsWith(txt) ? prev : (prev ? `${prev}\n${txt}` : txt));

    /* 处理结构化摘要 */
    const handleSummaryUpdate = async (jsonStr) => {
        const { summary } = JSON.parse(jsonStr);
        setStructuredJson(jsonStr);
        const newMap = new Map(summary.map(x => [x.id, x]));
        const editor = quillRef.current.getEditor();
        const diff = editor.getContents().diff(toDelta(newMap));

        const statics = diff.ops.filter(op => !op.insert);
        statics.length && editor.updateContents({ ops: statics }, "silent");

        for (const op of diff.ops) if (op.insert) {
            const start = editor.getLength() - 1;
            await new Promise(res => {
                let i = 0; const id = setInterval(() => { if (i >= op.insert.length) { clearInterval(id); res(); return; } editor.insertText(start + i, op.insert[i]); i++; }, TYPE_SPEED);
            });
        }
        setSummaryMap(newMap);
    };

    /* next-topic prompt (略) —— 与之前一样 */

    const exportMd = () => {/* …保持不变… */ };

    /* ----------------- UI ----------------- */
    return (
        <div className="app-container">
            {/* ⭐ 顶部标题 */}
            <h1 className="logo-title">Meeting Agent</h1>

            {/* ===== Top-bar ===== */}
            <div className="top-bar">
                <div className="actions">
                    <button className="btn" onClick={() => setShowAudio(s => !s)}>
                        {showAudio ? "Close Audio" : "Upload Audio"}
                    </button>

                    <button
                        className={`btn ${live ? "live-on" : ""}`}
                        onClick={() => setLive(l => !l)}
                    >
                        {live ? "Stop Live" : "Start Live"}
                    </button>

                    <button className="btn" onClick={() => pptRef.current?.openDialog()}>
                        Upload PPT
                    </button>
                </div>

                <div className="next-panel">
                    <h4 className="panel-title">Next Topic</h4>

                    {nextMd ? (
                        <div className="prose prose-sm">
                            <ReactMarkdown>{nextMd}</ReactMarkdown>
                        </div>
                    ) : (
                        <p className="hint">(Start Meeting to enable)</p>
                    )}
                </div>

            </div>

            {/* ===== conditional forms ===== */}
            {showAudio && (
                <AudioTranscription
                    onTranscriptUpdate={appendTranscript}
                    onSummaryUpdate={handleSummaryUpdate}
                />
            )}

            {live && (
                <ImprovedLiveTranscription
                    active={live}
                    onTranscriptUpdate={appendTranscript}
                    onSummaryUpdate={handleSummaryUpdate}
                />
            )}

            {/* invisible uploader */}
            <PPTUpload ref={pptRef} headless onOutlineReady={setPptOutline} />

            {/* =====  Main Grid  ===== */}
            <div className={`main-content ${pptOutline ? "three-cols" : "two-cols"}`}>
                {/* Transcription */}
                <section className="panel">
                    <h3 className="panel-title">Transcription</h3>
                    {/* <pre ref={transRef}
                        className={`scroll-box ${!transcript && "placeholder"}`}>
                        {transcript || "Transcription will appear here after you start Live or upload Audio."}
                    </pre> */}
                    <div ref={transRef}
                        className={`scroll-box ${!transcript && "placeholder"}`}>
                        {transcript
                            ? transcript.split("\n").map((ln, idx, arr) => (
                                <p key={idx} className={idx === arr.length - 1 ? "font-semibold" : ""}>
                                    {ln}
                                </p>
                            ))
                            : "Transcription will appear here after you start Live or upload Audio."}
                    </div>
                </section>

                {/* Outline */}
                {pptOutline && (
                    <section className="panel">
                        <h3 className="panel-title">Presentation Outline</h3>
                        <pre className="scroll-box" style={{ maxHeight: "none" }}>{pptOutline}</pre>
                    </section>
                )}

                {/* Structured Summary */}
                <section className="panel">
                    <h3 className="panel-title">Structured Summary</h3>
                    <ReactQuill ref={quillRef} readOnly theme="snow" modules={{ toolbar: false }} />
                    <button className="btn" style={{ marginTop: "0.75rem" }} onClick={exportMd}>
                        Export Markdown
                    </button>
                </section>
            </div>
        </div>
    );
}
