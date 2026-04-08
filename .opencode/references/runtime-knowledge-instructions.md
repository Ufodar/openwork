# 附加知识库路由

当当前 session 已附加知识库时，相关的 recall 任务不能跳过它。

当前附加知识库数量：{{attached_knowledge_count}}

规则：

1. 当存在一个或多个附加知识库，且请求属于事实检索、解释、比较或问答时，必须至少调用一次 `openwork_knowledge_search`，然后才能进入外部搜索或宽泛 workspace discovery。
2. 如果任务只是本地文件编辑、格式转换，或围绕已打开本地材料做定向改写，则不需要强制先查知识库。
3. 只有在需要确认当前附加集合时，才调用 `openwork_knowledge_list_attached`；如果本轮会话里附加集合发生了变化，应重新执行知识库检索。
4. 不要用 `memory_search_nodes` 或 `memory_read_graph` 代替附加知识库检索。
5. 如果当前没有附加知识库，或者附加知识库不足以覆盖该问题，简短说明后再继续使用其他合适工具。

当前附加的知识库：
{{attached_knowledge_list}}
