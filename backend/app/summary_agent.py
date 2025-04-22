from langgraph.graph import StateGraph, END

# from langchain.chat_models import ChatOpenAI
from typing import TypedDict, Optional
import os
import openai

# 初始化 LLM
# llm = ChatOpenAI(model="gpt-4o", temperature=0)
openai.api_key = os.getenv("OPENAI_API_KEY")


# LangGraph 状态，新增 memory 字段用于存储历史 transcript
class MeetingState(TypedDict):
    transcript: str
    structured: Optional[str]
    memory: str  # 全部累计的会议内容


# 分段处理（可拓展），同时更新 memory
def segment_blocks(state: MeetingState) -> dict:
    prev_memory = state.get("memory", "")
    text = state["transcript"].strip()
    # 将本次 transcript 追加到 memory
    updated_memory = (prev_memory + "\n" + text).strip()
    return {"transcript": text, "memory": updated_memory}


# 自动结构化生成，使用 OpenAI API
def generate_structured_outline(state: MeetingState) -> dict:
    memory = state["memory"]
    prompt = f"""
你是一个会议总结助手。

以下是会议历史内容：
{memory}

请在此基础上，基于最新这一段内容生成**多级结构化总结**（编号格式如：1, 1.1, 1.2, 1.2.1）；
每个部分请包含简洁标题与对应内容。
只需输出最新的摘要结果。
"""
    response = openai.ChatCompletion.create(
        model="gpt-4o", messages=[{"role": "user", "content": prompt}], temperature=0
    )
    content = response.choices[0].message["content"]
    return {"structured": content, "memory": memory}


# 构建 LangGraph 流程，memory 字段会在 state 中自然流转
def build_structured_summary_graph():
    builder = StateGraph(MeetingState)
    builder.add_node("segment_blocks", segment_blocks)
    builder.add_node("generate_structure", generate_structured_outline)

    builder.set_entry_point("segment_blocks")
    builder.add_edge("segment_blocks", "generate_structure")
    builder.add_edge("generate_structure", END)

    return builder.compile()
