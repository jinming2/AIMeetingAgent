import React, { useState, forwardRef, useImperativeHandle } from "react";

/**
 * Upload a PPT / PPTX file, ask backend to summarise it,
 * then expose the outline to parent via onOutlineReady().
 */
// const PPTUpload = ({ onOutlineReady }) => {
const PPTUpload = forwardRef(({ onOutlineReady, headless = false }, ref) => {


    const [outline, setOutline] = useState("");
    const [isLoading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const hiddenInputRef = React.useRef(null);
    useImperativeHandle(ref, () => ({
        openDialog: () => hiddenInputRef.current?.click()
    }));

    /* choose file & call backend ------------------------------ */
    const handleFileUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (!file.name.match(/\.(ppt|pptx)$/i)) {
            setError("Please upload a PPT or PPTX file");
            return;
        }

        setLoading(true);
        setError("");
        setOutline("");

        const formData = new FormData();
        formData.append("file", file);

        try {
            const res = await fetch("http://localhost:8000/ppt/auto-summary", {
                method: "POST",
                body: formData,
            });

            if (!res.ok) {
                const errJson = await res.json();
                throw new Error(errJson.detail || "Failed to generate outline");
            }

            const { overall_summary } = await res.json();
            setOutline(overall_summary || "");
            onOutlineReady?.(overall_summary || "");
        } catch (err) {
            console.error(err);
            setError(err.message || "Failed to generate outline, please try again");
        } finally {
            setLoading(false);
        }
    };

    /* export markdown ----------------------------------------- */
    const handleExport = () => {
        const blob = new Blob([outline], { type: "text/markdown" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "presentation_outline.md";
        a.click();
    };

    /* ==== 在组件最开头加：如果 headless，则只渲染隐藏 input ==== */
    if (headless) {
        return (
            <input
                type="file"
                accept=".ppt,.pptx"
                className="hidden"
                ref={hiddenInputRef}
                onChange={handleFileUpload}
            />
        );
    }

    /* --------------------------------------------------------- */
    return (
        <div className="space-y-4">
            {/* upload box */}
            <div className="flex justify-center w-full">
                <label
                    htmlFor="ppt-upload"
                    className="flex flex-col items-center justify-center w-full h-32
                     border-2 border-dashed border-gray-300 rounded-lg
                     cursor-pointer bg-gray-50 hover:bg-gray-100"
                >
                    <div className="flex flex-col items-center pt-5 pb-6">
                        <svg
                            className="w-8 h-8 mb-4 text-gray-500"
                            viewBox="0 0 24 24"
                            fill="none" stroke="currentColor" strokeWidth="2"
                            strokeLinecap="round" strokeLinejoin="round"
                        >
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="17 8 12 3 7 8" />
                            <line x1="12" y1="3" x2="12" y2="15" />
                        </svg>
                        <p className="mb-2 text-sm text-gray-500">
                            <span className="font-semibold">Click to upload</span> or drag PPT file
                        </p>
                        <p className="text-xs text-gray-500">PPT or PPTX</p>
                    </div>
                    {/* <input
                        id="ppt-upload"
                        type="file"
                        className="hidden"
                        accept=".ppt,.pptx"
                        onChange={handleFileUpload}
                    /> */}

                    <input
                        id="ppt-upload"
                        type="file"
                        className="hidden"
                        accept=".ppt,.pptx"
                        onChange={handleFileUpload}
                        ref={hiddenInputRef}
                    />
                </label>
            </div>

            {/* error */}
            {error && (
                <div className="p-4 bg-red-100 text-red-700 rounded-md">{error}</div>
            )}

            {/* loading spinner */}
            {isLoading && (
                <div className="flex flex-col items-center space-y-2">
                    <div className="h-8 w-8 border-b-2 border-blue-500 rounded-full animate-spin"></div>
                    <p className="text-gray-600">Processing PPT, please wait…</p>
                </div>
            )}

            {/* outline result */}
            {!isLoading && outline && (
                <div className="bg-white p-6 rounded-lg shadow-md">
                    <h2 className="text-xl font-semibold mb-4 text-gray-800">
                        📈 Structured Outline
                    </h2>
                    <pre className="whitespace-pre-wrap bg-blue-50 p-4 rounded shadow">
                        {outline}
                    </pre>
                    <button
                        onClick={handleExport}
                        className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                    >
                        Export Markdown
                    </button>
                </div>
            )}
        </div>
    );
});

export default PPTUpload;
