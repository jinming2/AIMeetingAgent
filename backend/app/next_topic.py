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
    outline: str
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

    def parse_structured_outline(self, outline: str) -> List[Dict[str, str]]:
        """
        Parse outline string like:
        1. 【子主题1：XXX】\n - 开场引导…\n - 要点…
        into a list of {title, content} blocks
        """
        sections = re.split(r"\n\s*\d+\.\s+【(.*?)】", outline)
        result = []
        for i in range(1, len(sections), 2):
            title = sections[i]
            content = sections[i+1].strip()
            result.append({"title": title, "content": content})
        return result

    def choose_next(self, state: TalkState) -> TalkState:
        if state.pointer >= len(state.outline_sections):
            raise HTTPException(status_code=200, detail="🎉 已经讲完全部大纲！")
        return state

    def craft_prompt(self, state: TalkState) -> TalkState:
        block = state.outline_sections[state.pointer]

        system_msg = (
            "You are a helpful teleprompter. "
            "Given what the speaker has already said and the current outline section, "
            "give 3-5 bullet points they should cover next."
        )

        user_msg = f"""Speech so far:\n---\n{state.summary_so_far}\n\nNext section: {block.title}\n---\n{block.content}"""

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
