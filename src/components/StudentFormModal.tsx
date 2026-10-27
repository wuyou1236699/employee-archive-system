import { Archive, LoaderCircle, RotateCcw, Save, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { ServiceResult, StudentDetail, StudentDraft, StudentProfile } from "../types";
import { SelectField, TextField } from "./Field";

interface StudentFormModalProps {
  student: StudentDetail | null;
  detailLoading?: boolean;
  detailError?: string | null;
  onRetry?: () => void;
  onClose: () => void;
  onSave: (draft: StudentDraft) => ServiceResult<StudentProfile> | Promise<ServiceResult<StudentProfile>>;
  onArchive?: () => ServiceResult<StudentProfile> | Promise<ServiceResult<StudentProfile>>;
  onRestore?: () => ServiceResult<StudentProfile> | Promise<ServiceResult<StudentProfile>>;
}

function studentDraft(student: StudentDetail | null): StudentDraft {
  return student ? { name: student.name, phoneNumber: student.phoneNumber } : { name: "", phoneNumber: "" };
}

export function StudentFormModal({ student, detailLoading = false, detailError = null, onRetry, onClose, onSave, onArchive, onRestore }: StudentFormModalProps) {
  const [draft, setDraft] = useState<StudentDraft>(() => studentDraft(student));
  const [selectedStatus, setSelectedStatus] = useState<StudentProfile["status"]>(() => student?.status ?? "active");
  const [error, setError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const isStatusDirty = Boolean(student && selectedStatus !== student.status);
  const isDetailUnavailable = Boolean(student && (detailLoading || detailError));
  const isFormDisabled = isSaving || isDetailUnavailable || isStatusDirty;
  const statusActionLabel = !isStatusDirty ? "状态未改变" : selectedStatus === "inactive" ? "设为不在册" : "恢复为在册";

  useEffect(() => {
    setDraft(studentDraft(student));
    setSelectedStatus(student?.status ?? "active");
    setError(null);
    setIsDirty(false);
  }, [student]);

  function setField<K extends keyof StudentDraft>(field: K, value: StudentDraft[K]) {
    setDraft((current) => ({ ...current, [field]: value }));
    setIsDirty(true);
    setError(null);
  }

  function handleClose() {
    if (isSaving) return;
    if ((isDirty || isStatusDirty) && !window.confirm("当前有未保存的修改，确定放弃吗？")) return;
    onClose();
  }

  async function runAction(action: () => ServiceResult<StudentProfile> | Promise<ServiceResult<StudentProfile>>) {
    if (isSaving) return;
    setIsSaving(true);
    setError(null);
    try {
      const result = await action();
      if (!result.ok) {
        setError(result.message.includes("已被其他账号更新")
          ? "该学员档案已被其他账号更新，请关闭窗口并重新打开后再保存。"
          : result.message);
        return;
      }
      onClose();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "保存学员档案失败。");
    } finally {
      setIsSaving(false);
    }
  }

  function handleSave() {
    if (isStatusDirty) {
      setError("请先点击对应的状态按钮保存状态变更，或恢复原状态后再保存姓名和手机号。");
      return;
    }
    const name = draft.name.normalize("NFKC").trim();
    let phoneNumber = draft.phoneNumber.normalize("NFKC").trim().replace(/[\s\-‐‑‒–—―]/g, "");
    if (phoneNumber.startsWith("+86")) phoneNumber = phoneNumber.slice(3);
    if (name.length < 2 || name.length > 64) {
      setError("请填写有效的学员姓名。");
      return;
    }
    if (!/^1[3-9]\d{9}$/.test(phoneNumber)) {
      setError("请填写有效的本人手机号。");
      return;
    }
    void runAction(() => onSave({ name, phoneNumber }));
  }

  function handleUpdateStatus() {
    if (!student || isSaving || detailLoading || detailError || isDirty || !isStatusDirty) return;
    if (selectedStatus === "inactive") {
      if (!window.confirm("确定将这份学员档案设为“不在册”吗？设为不在册后，该手机号不能用于新学员注册匹配。")) return;
      if (onArchive) void runAction(onArchive);
      return;
    }
    if (onRestore) void runAction(onRestore);
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={handleClose}>
      <section className="editor-modal" role="dialog" aria-modal="true" aria-labelledby="student-editor-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="editor-header">
          <div>
            <span className="eyebrow">STUDENT PROFILE</span>
            <h2 id="student-editor-title">{student ? `学员档案 · ${student.name}` : "新增学员档案"}</h2>
          </div>
          <button className="icon-button" type="button" aria-label="关闭表单" onClick={handleClose}>
            <X size={19} />
          </button>
        </header>

        <div className="editor-body">
          <section className="form-section">
            <div className="form-section-heading"><span>01</span><h3>基本资料</h3></div>
            <div className="form-grid">
              <TextField label="姓名" required disabled={isFormDisabled} value={draft.name} onChange={(event) => setField("name", event.target.value)} />
              <TextField label="本人手机号" required inputMode="tel" autoComplete="tel" disabled={isFormDisabled} value={draft.phoneNumber} onChange={(event) => setField("phoneNumber", event.target.value)} />
              {student ? <SelectField
                label="档案状态"
                value={selectedStatus}
                disabled={isSaving || detailLoading || Boolean(detailError) || isDirty}
                onChange={(event) => {
                  setSelectedStatus(event.target.value as StudentProfile["status"]);
                  setError(null);
                }}
              >
                <option value="active">在册</option>
                <option value="inactive">不在册</option>
              </SelectField> : null}
            </div>
            {student ? <p className="field-hint">手机号仅在通过档案维护权限检查后读取，列表中不会显示。请先保存或取消姓名、手机号修改，再调整档案状态。</p> : <p className="field-hint">手机号用于普通账号注册匹配；列表中不会显示手机号。</p>}
          </section>
          {student && detailLoading ? <div className="form-message" role="status" aria-live="polite"><LoaderCircle className="spin" size={16} />正在读取学员详情；手机号会在读取完成后显示。</div> : null}
          {student && detailError ? <div className="form-message form-message-error" role="alert">{detailError}{onRetry ? <button className="text-button" type="button" disabled={isSaving} onClick={onRetry}>重试</button> : null}</div> : null}
          {student && !detailLoading && !detailError && isStatusDirty ? <div className="field-hint" role="status">状态尚未保存。点击下方“{statusActionLabel}”按钮应用，或恢复原状态继续编辑资料。</div> : null}
          {error ? <div className="form-message form-message-error" role="alert">{error}</div> : null}
        </div>

        <footer className="editor-footer">
          {student && (onArchive || onRestore) ? <button className={selectedStatus === "inactive" ? "secondary-button danger-button" : "secondary-button"} type="button" disabled={isSaving || detailLoading || Boolean(detailError) || isDirty || !isStatusDirty} onClick={handleUpdateStatus}>
            {isStatusDirty && selectedStatus === "inactive" ? <Archive size={16} /> : isStatusDirty ? <RotateCcw size={16} /> : null}
            {statusActionLabel}
          </button> : null}
          <button className="secondary-button" type="button" disabled={isSaving} onClick={handleClose}>取消</button>
          <button className="primary-button" type="button" disabled={isFormDisabled || isStatusDirty} onClick={handleSave}>
            {isSaving ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}
            保存档案
          </button>
        </footer>
      </section>
    </div>
  );
}
