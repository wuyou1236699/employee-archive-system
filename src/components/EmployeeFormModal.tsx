import { LoaderCircle, Save, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { Employee, EmployeeDraft, ServiceResult } from "../types";
import { employeeToDraft } from "../services/dataService";
import { SelectField, TextAreaField, TextField } from "./Field";

interface EmployeeFormModalProps {
  employee: Employee | null;
  departments: string[];
  onClose: () => void;
  onSave: (draft: EmployeeDraft) => ServiceResult<Employee> | Promise<ServiceResult<Employee>>;
}

const EMPTY_DRAFT: EmployeeDraft = {
  name: "",
  status: "active",
  department: "",
  personalPhone: "",
  workPhone: "",
  phonePlan: "",
  phoneOwnership: "",
  computerOwnership: "",
  hireDate: "",
  regularizationDate: "",
  notes: "",
  contractType: "",
  contractStartDate: "",
  contractEndDate: "",
  contractNotes: "",
  vehicleModel: "",
  vehiclePlateNumber: "",
  vehicleStartDate: "",
  vehicleEndDate: "",
  vehicleNotes: "",
};

function getInitialDraft(employee: Employee | null): EmployeeDraft {
  return employee ? employeeToDraft(employee) : { ...EMPTY_DRAFT };
}

export function EmployeeFormModal({ employee, departments, onClose, onSave }: EmployeeFormModalProps) {
  const [draft, setDraft] = useState<EmployeeDraft>(() => getInitialDraft(employee));
  const [error, setError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setDraft(getInitialDraft(employee));
    setError(null);
    setIsDirty(false);
  }, [employee]);

  function setField<K extends keyof EmployeeDraft>(field: K, value: EmployeeDraft[K]) {
    setDraft((current) => ({ ...current, [field]: value }));
    setIsDirty(true);
    setError(null);
  }

  function handleClose() {
    if (isSaving) return;
    if (isDirty && !window.confirm("当前表单有未保存的修改，确定放弃吗？")) {
      return;
    }
    onClose();
  }

  async function handleSave() {
    if (isSaving) return;
    setIsSaving(true);
    setError(null);
    try {
      const result = await onSave(draft);
      if (!result.ok) {
        setError(result.message.includes("已被其他账号更新")
          ? "该员工档案已被其他账号更新，请关闭编辑窗口并重新打开后再保存。"
          : result.message);
        return;
      }
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存员工档案失败。");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={handleClose}>
      <section className="editor-modal" role="dialog" aria-modal="true" aria-labelledby="employee-editor-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="editor-header">
          <div>
            <span className="eyebrow">{employee ? "EMPLOYEE UPDATE" : "NEW EMPLOYEE"}</span>
            <h2 id="employee-editor-title">{employee ? `编辑 ${employee.name}` : "新增员工档案"}</h2>
          </div>
          <button className="icon-button" type="button" aria-label="关闭表单" onClick={handleClose}>
            <X size={19} />
          </button>
        </header>

        <div className="editor-body">
          <section className="form-section">
            <div className="form-section-heading">
              <span>01</span>
              <h3>基础资料</h3>
            </div>
            <div className="form-grid form-grid-three">
              <TextField label="姓名" required value={draft.name} onChange={(event) => setField("name", event.target.value)} />
              <SelectField label="状态" value={draft.status} onChange={(event) => setField("status", event.target.value as EmployeeDraft["status"])}>
                <option value="active">在职</option>
                <option value="former">离职</option>
              </SelectField>
              <TextField
                label="部门 / 分组"
                required
                list="department-options"
                value={draft.department}
                onChange={(event) => setField("department", event.target.value)}
              />
              <datalist id="department-options">
                {departments.map((department) => <option value={department} key={department} />)}
              </datalist>
              <TextField label="个人手机号" value={draft.personalPhone} onChange={(event) => setField("personalPhone", event.target.value)} />
              <TextField label="工作电话" value={draft.workPhone} onChange={(event) => setField("workPhone", event.target.value)} />
              <TextField label="手机套餐 / 话补" value={draft.phonePlan} onChange={(event) => setField("phonePlan", event.target.value)} />
              <TextField label="手机归属" value={draft.phoneOwnership} onChange={(event) => setField("phoneOwnership", event.target.value)} />
              <TextField label="电脑归属" value={draft.computerOwnership} onChange={(event) => setField("computerOwnership", event.target.value)} />
            </div>
          </section>

          <section className="form-section">
            <div className="form-section-heading">
              <span>02</span>
              <h3>任职与合同</h3>
            </div>
            <div className="form-grid form-grid-three">
              <TextField label="入职日期" type="date" value={draft.hireDate} onChange={(event) => setField("hireDate", event.target.value)} />
              <TextField label="转正日期" type="date" value={draft.regularizationDate} onChange={(event) => setField("regularizationDate", event.target.value)} />
              <TextField label="合同类型" placeholder="如：当前合同" value={draft.contractType} onChange={(event) => setField("contractType", event.target.value)} />
              <TextField label="合同开始日期" type="date" value={draft.contractStartDate} onChange={(event) => setField("contractStartDate", event.target.value)} />
              <TextField label="合同结束日期" type="date" value={draft.contractEndDate} onChange={(event) => setField("contractEndDate", event.target.value)} />
              <TextField label="合同备注" value={draft.contractNotes} onChange={(event) => setField("contractNotes", event.target.value)} />
            </div>
          </section>

          <section className="form-section">
            <div className="form-section-heading">
              <span>03</span>
              <h3>车辆资料</h3>
            </div>
            <div className="form-grid form-grid-three">
              <TextField label="车辆型号" value={draft.vehicleModel} onChange={(event) => setField("vehicleModel", event.target.value)} />
              <TextField label="车牌号码" value={draft.vehiclePlateNumber} onChange={(event) => setField("vehiclePlateNumber", event.target.value)} />
              <TextField label="车辆备注" value={draft.vehicleNotes} onChange={(event) => setField("vehicleNotes", event.target.value)} />
              <TextField label="使用开始日期" type="date" value={draft.vehicleStartDate} onChange={(event) => setField("vehicleStartDate", event.target.value)} />
              <TextField label="使用结束日期" type="date" value={draft.vehicleEndDate} onChange={(event) => setField("vehicleEndDate", event.target.value)} />
            </div>
          </section>

          <section className="form-section">
            <div className="form-section-heading">
              <span>04</span>
              <h3>补充说明</h3>
            </div>
            <TextAreaField label="备注" rows={4} value={draft.notes} onChange={(event) => setField("notes", event.target.value)} />
          </section>

          {error ? <div className="form-message form-message-error editor-error">{error}</div> : null}
        </div>

        <footer className="editor-footer">
          <span className="required-note">* 必填字段</span>
          <div className="editor-actions">
            <button className="secondary-button" type="button" onClick={handleClose} disabled={isSaving}>取消</button>
            <button className="primary-button" type="button" onClick={handleSave} disabled={isSaving}>
              {isSaving ? <LoaderCircle size={16} /> : <Save size={16} />}
              {isSaving ? "保存中…" : "保存档案"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
