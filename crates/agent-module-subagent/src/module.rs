//! 模块身份与 `mount`：技能随模块走。
//!
//! ## 为什么这个文件存在
//!
//! 此前本 crate 只暴露 `MANIFEST_TOML` 字符串，`mount` 闭包在**宿主**里
//! （`push_builtin_identity` 传的是空闭包），技能正文也由宿主硬编码进
//! `builtin_modules::skill_contributions()`。那个形状有两个毛病：
//!
//! 1. 模块在 `modules.toml` 里被 `enabled = false` 关掉，技能照样进提示词
//!    ——模型被教了一个本部署根本没有的 `spawn_subagent`；
//! 2. 技能归属写在宿主里，新增模块必须改 Core。
//!
//! 现在本 crate 自己交出正文：`mount` 时经 `echo_defs::skill::SKILL_REGISTRAR`
//! 登记，卸载时撤销。技能的有无因此与模块的挂载状态**同一件事**。
//!
//! ## 依赖纪律
//!
//! 只新增 `echo-module`（框架层，构造 `BuiltinModule` 必需）与 `echo-context`
//! （服务键解析）。**不依赖** `agent-module-skills`：注册接缝在定义层
//! （`echo-defs`），解析在技能模块内部——本 crate 只交正文，不认识 SKILL.md
//! 的格式规则（见 [`SKILL_MARKDOWN`](crate::SKILL_MARKDOWN) 的文档）。

use std::sync::Arc;

use echo_module::{BuiltinModule, Module, ModuleManifest, MountContext};

use crate::{MODULE_ID, MANIFEST_TOML, SKILL_MARKDOWN};

/// 本模块贡献的技能：`(SKILL.md 全文, frontmatter 缺失时的兜底名)`。
///
/// 正文与归属同住本 crate：`spawn_subagent` 怎么用、什么时候该用、失败了
/// 怎么停——全是本模块的领域知识，正文跟着工具走才不会漂移。
const CONTRIBUTED_SKILLS: &[(&str, &str)] = &[(SKILL_MARKDOWN, "subagent-delegation")];

/// 模块清单：从 `module.toml` 解析，只把版本号留给宿主注入。
pub fn manifest(version: &str) -> ModuleManifest {
    ModuleManifest::from_toml(MANIFEST_TOML, version)
        .expect("agent-module-subagent 的 module.toml 解析失败")
}

/// 构造模块（宿主装配期调用一次）。
pub fn module(version: &str) -> Arc<dyn Module> {
    Arc::new(BuiltinModule::new(manifest(version), mount))
}

/// `mount`：登记技能，并在卸载时撤销。
///
/// 服务缺席是**降级**而不是错误（软依赖，见 `module.toml` 的
/// `optional_requires`）：没有技能模块的宿主（单测 / 嵌入式）照样能用
/// `spawn_subagent`，只是没有那段提示词。反过来把它写成硬依赖会让
/// "关掉技能目录"变成一个启动期故障，那不在本模块的权限内。
fn mount(mctx: &MountContext) -> echo_module::ModuleMountResult {
    let Some(ctx) = mctx.context() else {
        return Ok(Vec::new());
    };
    let Some(registrar) = ctx.service(&echo_defs::skill::SKILL_REGISTRAR) else {
        tracing::warn!(
            module = MODULE_ID,
            "技能注册接缝缺席：本模块的技能未进提示词（宿主未挂载 skills.dir）"
        );
        return Ok(Vec::new());
    };
    if let Err(error) = registrar.register_markdown(MODULE_ID, CONTRIBUTED_SKILLS) {
        // 登记失败不阻止挂载：`spawn_subagent` 仍可用，缺的只是提示词里的
        // 那段规则。挂载失败会让整个委派能力消失，代价大得多。
        tracing::warn!(module = MODULE_ID, %error, "技能登记失败");
        return Ok(Vec::new());
    }
    Ok(vec![echo_defs::Disposer::from_fn(move || {
        registrar.unregister(MODULE_ID);
    })])
}
