import { useState } from "react";
import AudioTranscription from "./components/AudioTranscription";
import ImprovedLiveTranscription from "./components/ImprovedLiveTranscription";

function App() {
    const [transcript, setTranscript] = useState(
        "用户A：我们今天要确定产品发布时间。\n用户B：我建议7月初，这样有足够时间测试。\n用户C：我负责测试，6月25号能完成。\n用户A：那我们7月5号发布吧。"
    );
    const [summary, setSummary] = useState(
        "- 会议议题：产品发布日期确定\n- 关键观点：建议7月初，测试6月25完成\n- 任务：李雷 - 测试完成 - 截止6月25\n         张伟 - 发布产品 - 截止7月5"
    );
    const [activeTab, setActiveTab] = useState("upload"); // "upload" or "live"

    // This function will be called by the ImprovedLiveTranscription component
    // when new transcription text is available
    const handleTranscriptUpdate = (newTranscript) => {
        console.log("App received transcript update:", newTranscript);
        setTranscript(newTranscript);
        
        // Here you would typically also update the summary
        // Either by calling another API or using a client-side processing function
    };

    const handleExport = () => {
        const blob = new Blob([summary], { type: "text/markdown" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "meeting_summary.md";
        a.click();
    };

    return (
        <div className="p-8 space-y-8 font-sans bg-gray-50 min-h-screen">
            <header className="text-3xl font-bold text-center text-blue-800">🧠 会议助手 - Agent 驱动</header>
            
            {/* Transcription Tabs */}
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
            </div>
            
            {/* Conditional Rendering of Components */}
            {activeTab === "upload" ? (
                <AudioTranscription />
            ) : (
                <ImprovedLiveTranscription onTranscriptUpdate={handleTranscriptUpdate} />
            )}
            
            <div className="grid md:grid-cols-2 gap-8">
                <section className="bg-white p-6 rounded-lg shadow-md">
                    <h2 className="text-xl font-semibold mb-4 text-gray-800">📡 转写内容</h2>
                    <pre className="bg-gray-100 p-4 rounded shadow max-h-64 overflow-y-auto whitespace-pre-wrap text-gray-700">
                        {transcript}
                    </pre>
                </section>

                <section className="bg-white p-6 rounded-lg shadow-md">
                    <h2 className="text-xl font-semibold mb-4 text-gray-800">📋 结构化摘要</h2>
                    <pre className="bg-blue-50 p-4 rounded shadow whitespace-pre-wrap text-gray-800">
                        {summary}
                    </pre>
                    <button
                        onClick={handleExport}
                        className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                    >
                        导出 Markdown
                    </button>
                </section>
            </div>
        </div>
    );
}

export default App;