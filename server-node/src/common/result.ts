/**
 * 统一返回格式 —— v1 契约逐字对齐（deck-loop-share Result.java）：
 * status=true 时 code 固定 '0'、msg='success'；失败时 code 为错误码
 * （默认 '500'，BizException 时为 BIZ_* 业务码）。
 * 契约冻结：字段名/取值不得私改（node-specs 20 §1）。
 */
export class Result<T> {
  /** v1 Result.CODE_SUCCESS */
  static readonly CODE_SUCCESS = '0';
  /** v1 Result.CODE_FAIL */
  static readonly CODE_FAIL = '500';

  readonly status: boolean;
  readonly code: string;
  readonly msg: string;
  readonly data: T | null;
  readonly timestamp: number;

  private constructor(status: boolean, code: string, msg: string, data: T | null) {
    this.status = status;
    this.code = code;
    this.msg = msg;
    this.data = data;
    this.timestamp = Date.now();
  }

  /** 成功（data 可空：Result.success() → data=null） */
  static success<T = null>(data: T | null = null): Result<T> {
    return new Result<T>(true, Result.CODE_SUCCESS, 'success', data);
  }

  /** 失败：msg + 错误码（默认 '500'；业务异常传入 BIZ_* 码） */
  static fail<T = null>(msg: string, code: string = Result.CODE_FAIL): Result<T> {
    return new Result<T>(false, code, msg, null);
  }
}

/**
 * 分页返回格式（v1 PageResult.java 对齐）。
 */
export class PageResult<T> {
  readonly records: T[];
  readonly total: number;
  readonly pageNum: number;
  readonly pageSize: number;

  constructor(records: T[], total: number, pageNum: number, pageSize: number) {
    this.records = records;
    this.total = total;
    this.pageNum = pageNum;
    this.pageSize = pageSize;
  }

  static of<T>(records: T[], total: number, pageNum: number, pageSize: number): PageResult<T> {
    return new PageResult<T>(records, total, pageNum, pageSize);
  }
}

/**
 * 分页请求基类（v1 PageQuery.java 对齐；域 DTO 继承后补 class-validator 注解）。
 */
export class PageQuery {
  pageNum = 1;
  pageSize = 20;
}

/**
 * 下拉选项（v1 SelectOption.java 对齐）。
 */
export class SelectOption {
  readonly value: string;
  readonly label: string;

  constructor(value: string, label: string) {
    this.value = value;
    this.label = label;
  }

  static of(value: string, label: string): SelectOption {
    return new SelectOption(value, label);
  }
}

/**
 * 列表操作列项（v1 asset 域 OperItem 对齐：code/label/style，style=danger 红色危险操作）。
 */
export class OperItem {
  readonly code: string;
  readonly label: string;
  readonly style?: string;

  private constructor(code: string, label: string, style?: string) {
    this.code = code;
    this.label = label;
    this.style = style;
  }

  static of(code: string, label: string, style?: string): OperItem {
    return new OperItem(code, label, style);
  }
}
