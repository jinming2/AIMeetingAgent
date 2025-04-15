import { useState } from "react";

function App() {
    const [transcript, setTranscript] = useState(
        "用户A：我们今天要确定产品发布时间。\n用户B：我建议7月初，这样有足够时间测试。\n用户C：我负责测试，6月25号能完成。\n用户A：那我们7月5号发布吧。"
    );
    const [summary, setSummary] = useState(
        "- 会议议题：产品发布日期确定\n- 关键观点：建议7月初，测试6月25完成\n- 任务：李雷 - 测试完成 - 截止6月25\n         张伟 - 发布产品 - 截止7月5"
    );

    const handleExport = () => {
        const blob = new Blob([summary], { type: "text/markdown" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "meeting_summary.md";
        a.click();
    };

    return (
        <div className="p-8 space-y-6 font-sans">
            <header className="text-2xl font-bold">🧠 会议助手 - Agent 驱动</header>

            <section>
                <h2 className="text-xl font-semibold mb-2">📡 实时转写内容</h2>
                <pre className="bg-gray-100 p-4 rounded shadow max-h-64 overflow-y-auto whitespace-pre-wrap">
                    {transcript}
                </pre>
            </section>

            <section>
                <h2 className="text-xl font-semibold mb-2">📋 结构化摘要</h2>
                <pre className="bg-blue-50 p-4 rounded shadow whitespace-pre-wrap">
                    {summary}
                </pre>
                <button
                    onClick={handleExport}
                    className="mt-3 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                    导出 Markdown
                </button>
            </section>
        </div>
    );
}

export default App;
