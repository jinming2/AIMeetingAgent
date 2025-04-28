import os
from openai import OpenAI
import logging
from typing import Dict, List
import traceback

logger = logging.getLogger(__name__)

class SpeechGenerator:
    def __init__(self):
        self.openai_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        if not self.openai_client.api_key:
            raise ValueError("OpenAI API key not found in environment variables")
        logger.info("SpeechGenerator initialized with OpenAI client")

    async def generate_speech_content(self, summary: str, outline: Dict) -> str:
        """
        根据summary和outline生成演讲内容
        
        Args:
            summary: 会议摘要
            outline: PPT大纲
            
        Returns:
            str: 生成的演讲内容
        """
        try:
            logger.info("Starting to generate speech content")
            
            # 构建提示词
            prompt = f"""
            你是一个专业的演讲者。请根据以下会议摘要和PPT大纲，生成一段流畅的演讲内容。
            要求：
            1. 语言要自然流畅，适合口头表达
            2. 内容要覆盖所有重要点
            3. 要有适当的过渡和连接词
            4. 语气要专业但不失亲和力
            
            会议摘要：
            {summary}
            
            PPT大纲：
            {outline}
            
            请生成一段适合演讲的内容：
            """
            
            # 调用OpenAI API生成内容
            response = await self.openai_client.chat.completions.create(
                model="gpt-4-turbo-preview",
                messages=[
                    {"role": "system", "content": "你是一个专业的演讲者，擅长将技术内容转化为生动有趣的演讲。"},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.7,
                max_tokens=2000
            )
            
            speech_content = response.choices[0].message.content
            logger.info("Successfully generated speech content")
            return speech_content
            
        except Exception as e:
            error_msg = f"Error generating speech content: {str(e)}\n{traceback.format_exc()}"
            logger.error(error_msg)
            raise Exception(f"Error generating speech content: {str(e)}") 