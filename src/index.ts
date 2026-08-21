export { Context } from "./core/Context";
export type { FlagValue } from "./core/Context";

export { Menu } from "./core/Menu";

export { logger } from "./core/logger";
export type { Logger } from "./core/logger";

export * as prompt from "./core/prompt";

export { services } from "./services";
export type { ServicesRegistry } from "./services";

export { PipelineRegistry, Pipeline, PipelineStage, PipelineJob, PipelineTask, PipelineResultsAccessor } from "./services/pipeline";
export type {
    PipelineConfig,
    PipelineStageConfig,
    PipelineJobConfig,
    PipelineTaskConfig,
    PipelineTaskBase,
    CallbackTaskConfig,
    PipelineRunResult,
    PipelineEntityStatus
} from "./services/pipeline";

export { YamlService } from "./services/yaml";
export type { YamlPrepareActions } from "./services/yaml";

export { http, HttpService, HttpRegistry } from "./services/http";
export type {
    HttpMethod,
    HttpRequest,
    HttpResponse,
    HttpServiceConfig,
    RequestInterceptor,
    ResponseInterceptor,
    RequestContext,
    ResponseContext
} from "./services/http-types";

export { AzureDevOpsApi } from "./services/azdo-api";
export type {
    AzureDevOpsApiConfig,
    AzdoRequestOptions,
    AzdoProject,
    AzdoGitRepository,
    AzdoGitBranch,
    AzdoGitCommitRef,
    AzdoGitAuthor,
    AzdoGitPullRequest,
    AzdoBuildDefinition,
    AzdoBuild,
    AzdoPipeline,
    AzdoWorkItem,
    AzdoListResponse,
    AzdoWebHookSubscription,
    AzdoEnvironment,
    AzdoIdentityGroup,
    AzdoPolicyConfiguration,
    AzdoAgentPool,
    AzdoAgentQueue,
    AzdoVariableGroup,
    AzdoBuildFolder,
    AzdoServiceEndpoint,
    AzdoGitRef,
    AzdoGitTag,
    AzdoGitItem
} from "./services/azdo-api";

export { AzdoApiError, parseAzdoError, formatAzdoError } from "./services/azdo-errors";
export type { AzdoErrorDetail, AzdoErrorBody } from "./services/azdo-errors";

export { Notifier } from "./core/Notifier";
export * as senders from "./core/senders";
export * as classifiers from "./core/classifiers";
export * as messages from "./core/messages";

export type {
    ExecOptions,
    ExecResult,
    MenuTask,
    MenuOptionWithSelector,
    MenuOptionValue,
    MenuDefinition,
    ResolvedMenuEntry,
    TaskHooks,
    SuccessCallback,
    ErrorCallback,
    NotificationEvent,
    ErrorClassifier,
    ErrorMessageFormatter,
    Sender
} from "./core/types";

export { ServiceError } from "./core/types";