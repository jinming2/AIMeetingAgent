import React, { useState, useRef, useEffect } from "react";
import ReactQuill, { Quill } from "react-quill";
import Delta from "quill-delta";               // quill 已自带依赖
import "react-quill/dist/quill.snow.css";
import AudioTranscription from "./components/AudioTranscription";
import ImprovedLiveTranscription from "./components/ImprovedLiveTranscription";
import "./index.css";
import PPTUpload from "./components/PPTUpload2";

const TYPE_SPEED = 30;                         // 动画间隔

/* Map -> Delta ------------------------------------------------ */
const toDelta = (map) => {
    const ops = [];
    Array.from(map.values())
        .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
        .forEach((s) => {
            ops.push({ insert: `${s.id} ${s.title}\n${s.content}\n\n` });
        });
    return new Delta(ops);
};

export default function App() {
    const quillRef = useRef(null);
    const [summaryMap, setSummaryMap] = useState(new Map());
    const [transcript, setTranscript] = useState("");
    const [activeTab, setActiveTab] = useState("upload");

    /* 首次渲染空文档 */
    useEffect(() => {
        quillRef.current?.getEditor().setContents([]);
    }, []);

    /* 处理 LLM JSON ------------------------------------------------ */
    const handleSummaryUpdate = async (jsonStr) => {
        const { summary } = JSON.parse(jsonStr);
        const newMap = new Map(summary.map((x) => [x.id, x]));
        await applyDeltaDiff(summaryMap, newMap);
        setSummaryMap(newMap);
    };

    /* 关键逻辑：Delta diff + 仅动画 insert -------------------------- */
    async function applyDeltaDiff(oldMap, newMap) {
        const editor = quillRef.current.getEditor();
        const oldDelta = editor.getContents();
        const newDelta = toDelta(newMap);
        const diff = oldDelta.diff(newDelta);

        /** 先把所有非 insert 的变动一次 silent 应用 */
        const staticOps = diff.ops.filter((op) => !op.insert);
        if (staticOps.length) editor.updateContents({ ops: staticOps }, "silent");

        /** 对每个 insert（新增或改动）做逐字动画 */
        for (const op of diff.ops) {
            if (op.insert) {
                const start = editor.getLength() - 1;   // 永远在尾部插
                await typewriter(editor, op.insert, start);
            }
        }
    }

    /* 打字动画 ---------------------------------------------------- */
    function typewriter(editor, str, pos) {
        return new Promise((res) => {
            let i = 0;
            const t = setInterval(() => {
                if (i >= str.length) {
                    clearInterval(t);
                    res();
                    return;
                }
                editor.insertText(pos + i, str[i]);
                i++;
            }, TYPE_SPEED);
        });
    }

    /* Markdown 导出 ---------------------------------------------- */
    const exportMd = () => {
        const md = Array.from(summaryMap.values())
            .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
            .map((s) => `${s.id} ${s.title}\n${s.content}\n`)
            .join("\n");
        const blob = new Blob([md], { type: "text/markdown" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "meeting_summary.md";
        a.click();
    };

    /* ---------------------- UI 保持原状 -------------------------- */
    return (
        <div className="p-8 space-y-8 bg-gray-50 min-h-screen font-sans">
            <header className="text-3xl font-bold text-center text-blue-800">
                🧠 会议助手
            </header>

            <div className="flex space-x-4 mb-4">
                <button
                    className={`px-4 py-2 rounded-t-lg ${activeTab === "upload" ? "bg-white shadow-sm border-t border-l border-r" : "bg-gray-200"}`}
                    onClick={() => setActiveTab("upload")}
                >
                    上传音频转写
                </button>
                <button
                    className={`px-4 py-2 rounded-t-lg ${activeTab === "live" ? "bg-white shadow-sm border-t border-l border-r" : "bg-gray-200"}`}
                    onClick={() => setActiveTab("live")}
                >
                    实时语音转写
                </button>
                <button
                    className={`px-4 py-2 rounded-t-lg ${activeTab === "ppt" ? "bg-white shadow-sm border-t border-l border-r" : "bg-gray-200"}`}
                    onClick={() => setActiveTab("ppt")}
                >
                    PPT大纲生成
                </button>

            </div>

            {activeTab === "upload" ? (
                <AudioTranscription />
            ) : activeTab == "live" ? (
                < ImprovedLiveTranscription
                    onTranscriptUpdate={setTranscript}
                    onSummaryUpdate={handleSummaryUpdate}
                />
            ) : (
                <PPTUpload />
            )}

            {activeTab !== "ppt" && (
                <div className="grid md:grid-cols-2 gap-8">
                    <section className="bg-white p-6 rounded-lg shadow-md">
                        <h2 className="text-xl font-semibold mb-4">📡 转写内容</h2>
                        <pre className="bg-gray-100 p-4 rounded shadow max-h-64 overflow-y-auto whitespace-pre-wrap">
                            {transcript}
                        </pre>
                    </section>

                    <section className="bg-white p-6 rounded-lg shadow-md">
                        <h2 className="text-xl font-semibold mb-4">📋 结构化摘要</h2>
                        <ReactQuill
                            ref={quillRef}
                            readOnly
                            theme="snow"
                            modules={{ toolbar: false }}
                        />
                        <button
                            onClick={exportMd}
                            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                        >
                            导出 Markdown
                        </button>
                    </section>
                </div>
            )}
        </div>
    );
}
