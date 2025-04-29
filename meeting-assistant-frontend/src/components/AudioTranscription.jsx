import { useState } from 'react';

function AudioTranscription({ onSummaryUpdate }) {
    const [file, setFile] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [utterances, setUtterances] = useState([]);
    const [error, setError] = useState(null);

    const handleFileChange = (e) => {
        const selectedFile = e.target.files[0];
        if (selectedFile && selectedFile.type.startsWith('audio/')) {
            setFile(selectedFile);
            setError(null);
        } else if (selectedFile) {
            setError('Please select an audio file');
            setFile(null);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (!file) {
            setError('Please select an audio file');
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            const formData = new FormData();
            formData.append('file', file);

            const response = await fetch('http://localhost:8000/transcribe', {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) {
                throw new Error(`Server responded with status: ${response.status}`);
            }

            const data = await response.json();
            setUtterances(data.utterances || []);

            if (data.structured_summary && onSummaryUpdate) {
                onSummaryUpdate(data.structured_summary);
            }
        } catch (err) {
            setError(`Transcription failed: ${err.message}`);
            setUtterances([]);
        } finally {
            setIsLoading(false);
        }
    };

    const formatTime = (nanoseconds) => {
        const milliseconds = nanoseconds / 1000000;
        const seconds = Math.floor(milliseconds / 1000);
        const ms = Math.floor(milliseconds % 1000);
        return `${seconds}.${ms.toString().padStart(3, '0')}s`;
    };

    return (
        <div className="max-w-4xl mx-auto p-6 bg-white rounded-lg shadow-lg">
            <h2 className="text-2xl font-bold mb-6 text-gray-800">🎙️ Audio Transcription</h2>

            <form onSubmit={handleSubmit} className="mb-8">
                <div className="mb-4">
                    <label className="block mb-2 text-sm font-medium text-gray-700">
                        Upload Audio File
                    </label>
                    <input
                        type="file"
                        accept="audio/*"
                        onChange={handleFileChange}
                        className="block w-full px-3 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg cursor-pointer bg-gray-50 focus:outline-none"
                    />
                    <p className="mt-1 text-sm text-gray-500">
                        Supported formats: WAV, MP3, M4A, etc.
                    </p>
                </div>

                {file && (
                    <div className="mb-4 p-3 bg-blue-50 rounded-md">
                        <p className="text-sm text-blue-700">
                            Selected file: <span className="font-medium">{file.name}</span> ({(file.size / 1024 / 1024).toFixed(2)} MB)
                        </p>
                    </div>
                )}

                {error && (
                    <div className="mb-4 p-3 bg-red-50 rounded-md">
                        <p className="text-sm text-red-700">{error}</p>
                    </div>
                )}

                <button
                    type="submit"
                    disabled={isLoading}
                    className={`px-4 py-2 rounded-md text-white font-medium ${isLoading ? 'bg-blue-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
                        }`}
                >
                    {isLoading ? 'Transcribing...' : 'Transcribe Audio'}
                </button>
            </form>

            {isLoading && (
                <div className="flex justify-center my-8">
                    <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
                </div>
            )}

            {utterances.length > 0 && (
                <div className="mt-6">
                    <h3 className="text-xl font-semibold mb-4 text-gray-800">Transcription Results</h3>
                    <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                        {utterances.map((utterance, index) => (
                            <div key={index} className="mb-4 p-3 bg-white rounded shadow-sm">
                                <div className="flex justify-between items-start">
                                    <p className="text-gray-800">{utterance.text}</p>
                                    <span className="ml-2 text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                                        {utterance.language}
                                    </span>
                                </div>
                                <div className="mt-2 text-xs text-gray-500">
                                    Time: {formatTime(utterance.offset)} - {formatTime(utterance.offset + utterance.duration)}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

export default AudioTranscription;