import os
import logging
import openai
from typing import TypedDict, Optional
from langgraph.graph import StateGraph, END

# 配置 logger，确保 DEBUG 级别消息会输出
logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)
# 为 logger 添加一个控制台 handler
handler = logging.StreamHandler()
handler.setLevel(logging.DEBUG)
formatter = logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
handler.setFormatter(formatter)
if not logger.hasHandlers():
    logger.addHandler(handler)

# 初始化 OpenAI API Key
openai.api_key = os.getenv("OPENAI_API_KEY")
if not openai.api_key:
    logger.error("Missing OPENAI_API_KEY environment variable")


# 状态类型定义
class MeetingState(TypedDict):
    transcript: str
    structured: Optional[str]
    memory: str  # 累计的会议历史内容


def segment_blocks(state: MeetingState) -> dict:
    """
    将本次 transcript 追加到 memory。
    """
    prev_memory = state.get("memory", "")
    text = state.get("transcript", "").strip()
    # logger.info(
    #     f"[segment_blocks] received transcript={text!r}, prev_memory={prev_memory!r}"
    # )
    updated_memory = (prev_memory + "\n" + text).strip()
    # logger.info(f"[segment_blocks] updated_memory={updated_memory!r}")
    return {"transcript": text, "memory": updated_memory}


def generate_structured_outline(state: MeetingState) -> dict:
    """
    基于 memory 调用 OpenAI 生成多级结构化摘要。
    """
    # logger.warning("[generate_structured_outline] START")

    # OpenAI 调用代码
    client = openai.OpenAI()
    memory = state.get("memory", "").strip()
    prompt = f"""
你是一个会议总结助手。

以下是会议历史内容：
{memory}

请在此基础上，基于最新这一段内容生成多级结构化总结（编号格式如：1, 1.1, 1.2, 1.2.1）；
每个部分请包含简洁标题与对应内容。只需输出最新的摘要结果。
"""
    # logger.info(f"[generate_structured_outline] prompt:\n{prompt}")
    try:
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
        )
        usage = getattr(response, "usage", None)
        if usage:
            logger.info(
                f"[OpenAI usage] prompt_tokens={usage.prompt_tokens}, "
                f"completion_tokens={usage.completion_tokens}, total={usage.total_tokens}"
            )
        content = response.choices[0].message.content
        # logger.info(f"[generate_structured_outline] output summary:\n{content!r}")
        return {"structured": content, "memory": memory}
    except Exception as e:
        logger.exception("[generate_structured_outline] OpenAI call failed")
        return {"structured": f"【摘要失败】{e}", "memory": memory}


def build_structured_summary_graph():
    """
    构建 LangGraph 流程：先 segment_blocks，再 generate_structured_outline
    """
    builder = StateGraph(MeetingState)
    builder.add_node("segment_blocks", segment_blocks)
    builder.add_node("generate_structure", generate_structured_outline)

    builder.set_entry_point("segment_blocks")
    builder.add_edge("segment_blocks", "generate_structure")
    builder.add_edge("generate_structure", END)

    return builder.compile()
