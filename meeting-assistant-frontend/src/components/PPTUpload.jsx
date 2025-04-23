import { useState } from 'react';

const PPTUpload = () => {
    const [outline, setOutline] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');

    const handleFileUpload = async (event) => {
        const file = event.target.files[0];
        if (!file) return;

        // 检查文件类型
        if (!file.name.endsWith('.ppt') && !file.name.endsWith('.pptx')) {
            setError('请上传PPT文件 (.ppt 或 .pptx)');
            return;
        }

        setIsLoading(true);
        setError('');

        const formData = new FormData();
        formData.append('file', file);

        try {
            const response = await fetch('http://localhost:8000/ppt/outline', {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.detail || '生成大纲失败');
            }

            const data = await response.json();
            setOutline(data.outline);
        } catch (err) {
            console.error('Error:', err);
            setError(err.message || '生成大纲失败，请稍后重试');
        } finally {
            setIsLoading(false);
        }
    };

    const handleExport = () => {
        const blob = new Blob([outline], { type: "text/markdown" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "presentation_outline.md";
        a.click();
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-center w-full">
                <label
                    htmlFor="ppt-upload"
                    className="flex flex-col items-center justify-center w-full h-32 border-2 border-gray-300 border-dashed rounded-lg cursor-pointer bg-gray-50 hover:bg-gray-100"
                >
                    <div className="flex flex-col items-center justify-center pt-5 pb-6">
                        <svg
                            className="w-8 h-8 mb-4 text-gray-500"
                            aria-hidden="true"
                            xmlns="http://www.w3.org/2000/svg"
                            fill="none"
                            viewBox="0 0 20 16"
                        >
                            <path
                                stroke="currentColor"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth="2"
                                d="M13 13h3a3 3 0 0 0 0-6h-.025A5.56 5.56 0 0 0 16 6.5 5.5 5.5 0 0 0 5.207 5.021C5.137 5.017 5.071 5 5 5a4 4 0 0 0 0 8h2.167M10 15V6m0 0L8 8m2-2 2 2"
                            />
                        </svg>
                        <p className="mb-2 text-sm text-gray-500">
                            <span className="font-semibold">点击上传</span> 或拖拽PPT文件
                        </p>
                        <p className="text-xs text-gray-500">PPT 或 PPTX</p>
                    </div>
                    <input
                        id="ppt-upload"
                        type="file"
                        className="hidden"
                        accept=".ppt,.pptx"
                        onChange={handleFileUpload}
                    />
                </label>
            </div>

            {error && (
                <div className="p-4 text-red-700 bg-red-100 rounded-lg">
                    <p className="font-semibold">错误：</p>
                    <p>{error}</p>
                </div>
            )}

            {isLoading && (
                <div className="flex flex-col items-center justify-center space-y-2">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
                    <p className="text-gray-600">正在处理PPT文件，请稍候...</p>
                </div>
            )}

            {outline && (
                <div className="space-y-4">
                    <div className="bg-white p-6 rounded-lg shadow-md">
                        <h2 className="text-xl font-semibold mb-4 text-gray-800">📋 演讲大纲</h2>
                        <pre className="bg-blue-50 p-4 rounded shadow whitespace-pre-wrap text-gray-800">
                            {outline}
                        </pre>
                        <button
                            onClick={handleExport}
                            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                        >
                            导出 Markdown
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default PPTUpload; 