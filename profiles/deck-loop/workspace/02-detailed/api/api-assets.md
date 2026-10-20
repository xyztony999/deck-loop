# API 设计 — 素材与品牌资产 · 迭代话术库（S-01 / S-02）

| 属性 | 值 |
|------|-----|
| 模块编码 | S-01 素材与品牌资产管理、S-02 迭代话术库 |
| 接口域 | asset |
| 功能类型 | 主数据类（启停生命周期，无状态机） |
| 服务形态 | Node.js + TypeScript + NestJS + MongoDB（deck-loop-core 单服务，06-node-api-conventions） |
| 版本 | v1.2 |
| 日期 | 2026-10-08 |
| 输入 | prd-assets.md v1.1 / domain-model.md v1.2 |

## 1. 模块设计概述

### 1.1 业务背景及目标

一致性资产供给：素材/品牌规范保障多版本风格统一；话术库沉淀有效调整话术。被生成/调整/导出高频引用。

### 1.2 边界说明

| 做 | 不做 |
|----|------|
| 素材上传/元信息编辑/分类/停用启用/删除（未引用）、品牌规范 CRUD/默认设置、话术模板 CRUD/场景标签、三组 Select 选择器 | 素材在线编辑裁剪、字体文件上传（预置清单）、话术分享市场、素材打标 AI 化（后续） |

### 1.3 设计决策

| # | 决策 | 理由 |
|---|------|------|
| D1 | 被引用（refCount>0）素材/规范仅可停用不可删除（ADR-004） | 版本快照可回溯 |
| D2 | 主数据类：list/save/update 合一为 save，无 operList 强制需求（规约 §4.4 主数据不强制）——列表仍返回 operList 便于前端按钮控制 | 交互一致性 |
| D3 | 品牌规范 colors/fonts 为 JSON 值对象 | 结构轻且固定 |
| D4 | 全自管（MIXED 声明，无托管源） | 无外部同步 |

### 1.4 领域对象总览

| 对象 | 分类 | 说明 |
|------|------|------|
| 素材 Asset | 聚合根 | dl_asset |
| 品牌规范 BrandKit | 聚合根 | dl_brand_kit（logoAssetId 引用 Asset） |
| 话术模板 PromptTemplate | 聚合根（薄） | dl_prompt_template |

### 1.5 上下文映射

| 对方 | 关系 | 模式 |
|------|------|------|
| 创作迭代域 | 被引用（生成注入/导出渲染） | OHS 暴露素材文件与规范读取；引用方 ID 引用（ACL 于调用侧） |
| 账号域 | user 上下文 | 遵奉者 |

## 2. 跨聚合根设计

### 2.1 聚合根关系图

```
BrandKit(聚合根) ──0..1 logoAssetId──▶ Asset(聚合根)
PromptTemplate(聚合根)   （独立，无关联边）
```

### 2.2 跨聚合根不变量

| # | 不变量 | 守卫 |
|---|--------|------|
| INV-16 | BrandKit.logoAssetId 若非空必须为启用态 Asset | brandkit/save 校验 |
| INV-17 | 默认规范全局（用户维度）唯一 | set-default 事务内切换 |
| INV-18 | Asset 被 BrandKit.logo 引用或被任何版本快照引用时 refCount>0 且不可删除 | 引用计数维护于：上传 logo 绑定 / 版本留档回调 |

### 2.3 跨聚合根编排

素材删除事务内：校验 refCount=0 → 删除；brandkit 默认切换：旧默认置 false + 新默认置 true（单事务）。

## 3. 应用/基础设施层设计

### 3.1 接口规范

POST 业务接口；上传 POST multipart；缩略图由上传响应即时返回；Select 端点按栈规约 `/{domain}/select/{resource}-{action}` 入选择池。

### 3.2 依赖与约束

被依赖方（无出站依赖）；对象存储为基础设施。

### 3.3 权限模型

会话+属主；全部查询/写入强制 user_id。

### 3.4 公共规范

错误码：BIZ_ASSET_{ERROR}（BIZ_ASSET_IN_USE / BIZ_ASSET_TYPE_INVALID）、BIZ_BRANDKIT_{ERROR}（BIZ_BRANDKIT_IS_DEFAULT / BIZ_BRANDKIT_LOGO_INVALID）、BIZ_PROMPT_{ERROR}（BIZ_PROMPT_PLACEHOLDER_SYNTAX）；枚举 AssetType/AssetStatus/TemplateScene（枚举池）。

## 4. 聚合根详细设计

### 4.1 领域模型 — Asset（首位聚合根）

| 表 | 类型 | 说明 |
|----|------|------|
| dl_asset | 主表 | 素材元数据 |

**主表字段（dl_asset）**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| asset_id | VARCHAR(32) | PK | 雪花 |
| asset_name | VARCHAR(128) | ✅ | 名称（默认文件名） |
| category | VARCHAR(64) | — | 分类（自由文本目录） |
| asset_type | VARCHAR(32) | ✅ | AssetType |
| storage_key | VARCHAR(255) | ✅ | 对象存储 key |
| file_hash | VARCHAR(64) | ✅ | SHA-256（重复检测） |
| width / height | INT | — | 尺寸 |
| file_size | BIGINT | ✅ | 字节 |
| asset_status | VARCHAR(32) | ✅ | AssetStatus |
| ref_count | INT | ✅ | 被引用计数（默认 0） |
| user_id | VARCHAR(32) | ✅ | 属主 |
| data_version / delete_sign / 审计 | — | ✅ | 同规约 |

**BrandKit（dl_brand_kit）**：brand_kit_id PK、kit_name✅(≤50)、colors JSON✅(主色+辅色数组)、fonts JSON（title/body 字体名）、logo_asset_id、is_default INT(1)✅、user_id、公共字段层同规约。

**PromptTemplate（dl_prompt_template）**：template_id PK、title✅(≤50)、content✅(≤2000，{占位符})、category、template_scene✅(TemplateScene)、use_count INT✅(默认 0)、user_id、公共字段层同规约。

不变量：INV-19 上传类型 jpg/png/svg/webp、单文件 ≤10MB；INV-20 同 hash 重复上传提示复用（不重复存储）；INV-21 话术占位符语法 {名称}（≤10 处）。

### 4.2 状态模型

无状态机；启停生命周期（AssetStatus）。

### 4.3 子流程设计

无。

### 4.4 接口设计

#### 接口清单

| 接口 | 方法/路径 | 说明 |
|------|----------|------|
| 素材列表 | POST /asset/asset/list | 分页/分类/类型/状态/关键词 |
| 素材上传 | POST /asset/asset/upload | multipart |
| 素材编辑 | POST /asset/asset/save | 名称/分类 |
| 素材停用/恢复 | POST /asset/asset/disable · /enable | 状态 |
| 素材删除 | POST /asset/asset/delete | 仅 refCount=0 |
| 素材选择器 | POST /asset/select/asset-list | 选择池 |
| 规范列表 | POST /asset/brandkit/list | |
| 规范保存 | POST /asset/brandkit/save | 新建/编辑 |
| 规范删除 | POST /asset/brandkit/delete | 非默认且未被 deck 引用 |
| 规范设默认 | POST /asset/brandkit/set-default | |
| 规范选择器 | POST /asset/select/brandkit-list | 选择池 |
| 话术列表 | POST /asset/prompt/list | |
| 话术保存 | POST /asset/prompt/save | |
| 话术删除 | POST /asset/prompt/delete | |
| 话术选择器 | POST /asset/select/prompt-list | 选择池 |
| 话术使用计数 | POST /asset/prompt/touch | 指令引用后 +1 |
| 枚举字典 | POST /asset/dict/batch | AssetType/AssetStatus/TemplateScene |

#### 接口详情（关键接口）

**POST /asset/asset/upload**（multipart）— file✅、assetName、category。
规则：INV-19/INV-20（hash 命中返回 existingAssetId+assetUrl，不新建）。VO：assetId、assetUrl（限时）、thumbnailUrl、width/height、fileHash、duplicated(bool)。

**POST /asset/asset/list** — AO：pageNum/pageSize、keyword(name like)、category(eq)、assetType(eq)、assetStatus(eq)。
行 VO：assetId、assetName、thumbnailUrl、category、assetType、assetStatus、refCount、fileSize、updatedTime、operList[]（edit、disable=ACTIVE、enable=DISABLED、delete=refCount=0）。

**POST /asset/asset/delete** — 规则：refCount>0 → BIZ_ASSET_IN_USE。

**POST /asset/brandkit/save** — AO：brandKitId(空新建)、kitName✅、colors{primary,assistants[]}✅、fonts{title,body}、logoAssetId（启用态校验 INV-16）。

**POST /asset/brandkit/delete** — 规则：is_default 拒绝（BIZ_BRANDKIT_IS_DEFAULT）；被 deck.default_brand_kit_id 引用拒绝。

**POST /asset/select/asset-list** — AO：assetType(eq)、keyword。VO：SelectOption+扩展（选择池契约 asset.select.assetList）。
其余 Select 同池契约（brandkitList/promptList）。

**POST /asset/prompt/save** — AO：templateId、title、content、category、templateScene。校验：INV-21（BIZ_PROMPT_PLACEHOLDER_SYNTAX）。

### 4.5 领域事件与集成

事件机制（06-node-api-conventions §5）：无 MQ broker，改为进程内 EventEmitter 发布订阅——事件名=businessType、载荷与触发时机不变，数据库写入成功（事务提交）后发布；原 MQ Consumer→事件订阅（@OnEvent）。

| 事件 | businessType | 载荷 | 订阅方 |
|------|-------------|------|--------|
| 资产变更（素材/规范/话术） | asset_{resource}_changed | {resource}Id/op | 多端同步 |

仓储契约：三仓储标准；AssetRepository 含 hash 查重（uk_user_hash 唯一索引）与 refCount 原子更新（$inc，版本留档回调调用）。

## 5. 模块清单汇总

### 5.1 对外服务清单（OHS）

| 服务 | 路径 | 消费方 |
|------|------|--------|
| 素材文件访问（限时 URL 签发） | POST /asset/asset/file-url | 生成/导出/演示（域内） |
| 品牌规范读取 | POST /asset/brandkit/provider-get | 生成注入（域内） |

### 5.2 数据访问清单（MongoDB）

| 数据访问 | collection | 操作 |
|----------|-----------|------|
| 素材 hash 查重/插入/引用计数更新 | dl_asset | findOne（uk_user_hash）/insertOne/updateOne（$inc ref_count） |
| 规范默认切换事务 | dl_brand_kit | updateMany（多文档事务：旧默认置 0+新默认置 1） |
| 三集合分页 | dl_asset / dl_brand_kit / dl_prompt_template | find（AO→查询字段白名单映射；skip/limit） |

### 5.3 MongoDB collection 设计

#### dl_asset（聚合根 Asset=document）

| 项目 | 值 |
|------|-----|
| 主键 | _id=ObjectId（仅存储，不进 VO）；asset_id=业务主键（string，唯一索引） |
| 嵌入 | 无结构化嵌入（元数据标量；缩略图由上传时对象存储生成，不落文档） |
| 引用 | 无出站引用；被 dl_brand_kit.logo_asset_id 与版本 content 引用（ref_count 计数维护，INV-18） |

字段清单（=v1 列平移）：asset_id(string,✅,业务主键)、asset_name(string,✅)、category(string,—)、asset_type(string,✅,AssetType)、storage_key(string,✅,对象存储 key)、file_hash(string,✅,SHA-256)、width/height(number,—)、file_size(number,✅,字节)、asset_status(string,✅,AssetStatus)、ref_count(number,✅,默认 0)、user_id(string,✅,属主)、data_version/delete_sign(number,✅)、审计（by/name=string、time=date）。

索引：uk_asset_id{asset_id}unique；uk_user_hash{user_id, file_hash}unique（重复上传检测 INV-20）；idx_user_type{user_id, asset_type, asset_status}。

#### dl_brand_kit（聚合根 BrandKit=document）

| 项目 | 值 |
|------|-----|
| 主键 | _id=ObjectId（仅存储）；brand_kit_id=业务主键（string，唯一索引） |
| 嵌入 | colors=object（{primary,assistants[]}）、fonts=object（{title,body}）——无独立生命周期值对象，整体嵌入 |
| 引用（仅存业务 id） | logo_asset_id→dl_asset（string；INV-16 应用层守卫） |

字段清单（=v1 列平移）：brand_kit_id(string,✅,业务主键)、kit_name(string,✅,≤50)、colors(object,✅,{primary,assistants[]})、fonts(object,—,{title,body})、logo_asset_id(string,—,跨聚合引用)、is_default(number,✅,0/1)、user_id(string,✅)、data_version/delete_sign(number,✅)、审计。

索引：uk_brand_kit_id{brand_kit_id}unique；idx_user{user_id, delete_sign}。

#### dl_prompt_template（聚合根 PromptTemplate=document）

| 项目 | 值 |
|------|-----|
| 主键 | _id=ObjectId（仅存储）；template_id=业务主键（string，唯一索引） |
| 嵌入 | 无（content 为含 {占位符} 的 string 值） |
| 引用 | 无（独立聚合，无关联边） |

字段清单（=v1 列平移）：template_id(string,✅,业务主键)、title(string,✅,≤50)、content(string,✅,≤2000 含{占位符})、category(string,—)、template_scene(string,✅,TemplateScene)、use_count(number,✅,默认 0)、user_id(string,✅)、data_version/delete_sign(number,✅)、审计。

索引：uk_template_id{template_id}unique；idx_user_scene{user_id, template_scene}。

> 索引均以 schema 声明式创建（06-node-api-conventions §3.5）。

## 6. 更新记录

| 版本 | 日期 | 变更类型 | 说明 |
|------|------|---------|------|
| v1.0 | 2026-10-07 | initial | 首次生成（三聚合根） |
| v1.1 | 2026-10-08 | structural | 服务形态改 Node/TS/NestJS+MongoDB（D0-v3）；§5.3 DDL→三 collection 设计（colors/fonts 值对象嵌入、logo_asset_id 跨聚合引用、uk_user_hash 唯一索引平移）；§4.5 MQ→进程内事件（businessType 不变）。接口契约冻结不变 |
| v1.2 | 2026-10-08 | restored | 复议恢复多端同步（D0-v3 §5，ADR-013 修订）：§4.5 asset_{resource}_changed 订阅方恢复「多端同步」v1 原订阅方。契约与 collection 设计不变 |
