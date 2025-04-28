from typing import List, Dict
from fastapi import HTTPException
from pydantic import BaseModel
from langgraph.graph import StateGraph, START, END
from langchain_openai import ChatOpenAI
import os, re
import logging

logger = logging.getLogger(__name__)

# -----------------------------------------------------------
# Step 1: State definitions

class OutlineBlock(BaseModel):
    title: str
    content: str

class TalkState(BaseModel):
    outline_sections: List[OutlineBlock]
    pointer: int = 0
    summary_so_far: str
    next_prompt: str | None = None

class NextTopicRequest(BaseModel):
    outline: str | None = None
    history: str
    pointer: int | None = 0

class NextTopicService:
    def __init__(self):
        self.llm = ChatOpenAI(model="gpt-4o-mini", temperature=0.3)
        self.graph = self._build_graph()
        logger.info("NextTopicService initialized")

    def _build_graph(self):
        g = StateGraph(state_schema=TalkState)
        g.add_node("choose", self.choose_next)
        g.add_node("prompt", self.craft_prompt)
        g.add_edge(START, "choose")
        g.add_edge("choose", "prompt")
        g.add_edge("prompt", END)
        return g.compile()

    def parse_structured_outline(self, outline: str | None) -> List[Dict[str, str]]:
        """
        Parse outline string like:
        1. 【子主题1：XXX】\n - 开场引导…\n - 要点…
        into a list of {title, content} blocks
        """
        if not outline:
            return [{"title": "自由演讲", "content": "请根据历史内容继续演讲"}]
            
        try:
            sections = re.split(r"\n\s*\d+\.\s+【(.*?)】", outline)
            result = []
            for i in range(1, len(sections), 2):
                title = sections[i]
                content = sections[i+1].strip()
                result.append({"title": title, "content": content})
            return result
        except Exception as e:
            logger.error(f"Error parsing outline: {str(e)}")
            return [{"title": "自由演讲", "content": "请根据历史内容继续演讲"}]

    def choose_next(self, state: TalkState) -> TalkState:
        if state.pointer >= len(state.outline_sections):
            raise HTTPException(status_code=200, detail="🎉 已经讲完全部大纲！")
        return state

    def craft_prompt(self, state: TalkState) -> TalkState:
        block = state.outline_sections[state.pointer]

        system_msg = (
            "你是一个专业的演讲提示助手。你的任务是帮助演讲者保持演讲的连贯性和专业性。\n"
            "请根据以下要求生成提示：\n"
            "1. 提示应该简洁明了，每个要点不超过20个字\n"
            "2. 提示应该自然流畅，符合演讲的语境\n"
            "3. 提示应该帮助演讲者自然地过渡到下一个话题\n"
            "4. 如果大纲中有具体内容，请确保提示包含这些关键点\n"
            "5. 提示应该保持专业性，避免口语化表达\n"
            "请生成3-5个要点，每个要点用短句表示。"
        )

        user_msg = f"""演讲历史内容：
{state.summary_so_far}

当前章节标题：{block.title}
章节内容：{block.content}

请根据以上内容，生成接下来要讲的要点提示。"""

        logger.info(f"Generating prompt for section: {block.title}")
        response = self.llm.invoke([
            {"role": "system", "content": system_msg},
            {"role": "user", "content": user_msg}
        ])

        state.next_prompt = response.content.strip()
        state.pointer += 1
        return state

    def get_next_topic(self, req: NextTopicRequest) -> Dict[str, str]:
        try:
            parsed = self.parse_structured_outline(req.outline)
            sections = [OutlineBlock(**p) for p in parsed]

            state = TalkState(
                outline_sections=sections,
                pointer=req.pointer or 0,
                summary_so_far=req.history
            )

            raw_result = self.graph.invoke(state)
            result = TalkState(**raw_result) 
            
            # 如果没有outline，只返回prompt
            if not req.outline:
                return {
                    "next_prompt": result.next_prompt
                }
                
            # 有outline时返回完整信息
            return {
                "next_prompt": result.next_prompt,
                "next_pointer": result.pointer,
                "remaining_sections": len(sections) - result.pointer,
                "current_title": sections[result.pointer - 1].title
            }
        except Exception as e:
            logger.error(f"Error getting next topic: {str(e)}")
            raise HTTPException(status_code=500, detail=str(e))

# 检查必要的环境变量
required_env_vars = ["OPENAI_API_KEY", "AZURE_SPEECH_KEY", "AZURE_SPEECH_REGION"]
missing_vars = [var for var in required_env_vars if not os.getenv(var)]
if missing_vars:
    raise ValueError(f"Missing required environment variables: {', '.join(missing_vars)}")
