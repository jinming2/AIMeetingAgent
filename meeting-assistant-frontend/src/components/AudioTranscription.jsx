import { useState } from "react";

/**
 *  AudioTranscription 组件
 *  ---------------------------------------------
 *  • 只负责上传音频并调用 /transcribe
 *  • 返回的 utterances 会拼成纯文本，通过 onTranscriptUpdate 传给父组件
 *  • 若后端还回 structured_summary，则通过 onSummaryUpdate 继续上报
 *  • 组件内部不再展示转写结果列表
 */
export default function AudioTranscription({
    onTranscriptUpdate,
    onSummaryUpdate,
}) {
    const [file, setFile] = useState(null);
    const [isLoading, setLoading] = useState(false);
    const [error, setError] = useState("");

    /* 选文件 */
    const handleChoose = (e) => {
        const f = e.target.files[0];
        if (!f) return;
        if (!f.type.startsWith("audio/")) {
            setError("Please choose an audio file");   // 只接受音频
            return;
        }
        setFile(f);
        setError("");
    };

    /* 上传并调用后端 */
    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!file) return setError("Choose an audio file first");

        setLoading(true);
        setError("");

        try {
            const fd = new FormData();
            fd.append("file", file);

            // 如需改部署地址，把下面 URL 改为相对路径 `/transcribe`
            const res = await fetch("http://localhost:8000/transcribe", {
                method: "POST",
                body: fd,
            });
            if (!res.ok) throw new Error("Server " + res.status);

            const data = await res.json();

            /* 1️⃣ 纯文本回传给父组件 */
            if (data.utterances?.length) {
                const txt = data.utterances.map((u) => u.text).join("\n");
                onTranscriptUpdate?.(txt);
            }

            /* 2️⃣ structured_summary 继续回传 */
            if (data.structured_summary) {
                onSummaryUpdate?.(data.structured_summary);
            }

            setFile(null);              // reset
            e.target.reset();           // 清空 <input type=file>
        } catch (err) {
            console.error(err);
            setError(err.message || "Upload failed");
        } finally {
            setLoading(false);
        }
    };

    return (
        <form className="panel" onSubmit={handleSubmit}>
            <h3 className="panel-title">Audio Transcription</h3>



            <input type="file" accept="audio/*" onChange={handleChoose} />

            {file && (
                <p className="text-sm text-gray-600 mt-1">
                    Selected: <strong>{file.name}</strong>
                </p>
            )}

            <p className="mt-1 text-sm text-gray-600 font-medium">
                Supported formats: <strong>.wav  .mp3  .m4a  .flac  .ogg</strong>
            </p>

            {error && (
                <p className="text-sm text-red-600 mt-1">
                    {error}
                </p>
            )}

            <button
                type="submit"
                disabled={isLoading}
                className={`btn ${isLoading && 'cursor-not-allowed opacity-60'}`}
            >
                {isLoading ? 'Transcribing…' : 'Transcribe Audio'}
            </button>


        </form >
    );
}
