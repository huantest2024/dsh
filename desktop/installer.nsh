; ===== DeepSeek Harness 桌面版 安装/卸载钩子（NSIS）=====
; 升级前强制退出旧版；卸载默认保留应用数据，
; 用户显式选择「删除」才清理，会话等 dsh 数据（~/.dsh）任何情况都不动。
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "nsDialogs.nsh"

; 升级前先退出旧版（含托盘常驻），避免文件占用导致升级失败
!macro customInit
  DetailPrint "正在关闭正在运行的旧版本..."
  nsExec::Exec `"$SYSDIR\cmd.exe" /c taskkill /f /im "DeepSeek Harness.exe" /fi "USERNAME eq %USERNAME%"`
  Sleep 800
!macroend

!ifdef BUILD_UNINSTALLER
Var /GLOBAL DshDataMode
Var /GLOBAL DshRadioKeep
Var /GLOBAL DshRadioDel
Var /GLOBAL DshDlg
Var /GLOBAL DshTmp

; 模板对交互式卸载会强制 silent（跳过向导页）；
  ; 这里区分「用户显式 /S」与「交互卸载」：仅后者恢复非静默以显示向导。
!macro customUnInit
  StrCpy $DshDataMode "keep"
  ${GetParameters} $DshTmp
  ${GetOptions} $DshTmp "/S" $DshTmp
  ${If} $DshTmp != ""
    SetSilent normal
  ${EndIf}
!macroend

; 卸载向导：数据选择 → 卸载进度
UninstPage custom un.DshDataPage un.DshLeaveData
UninstPage instfiles

; 向导页：选择应用数据处理方式（默认保留）
Function un.DshDataPage
  ${If} ${Silent}
    Abort
  ${EndIf}
  nsDialogs::Create 1018
  Pop $DshDlg
  ${NSD_CreateLabel} 0 -2u 100% 24u "即将卸载 DeepSeek Harness。请选择如何处理应用数据（设置、更新运行时、缓存、日志）："
  Pop $DshTmp
  ${NSD_CreateRadioButton} 8u 30u 92% 10u "保留应用数据（推荐）——重新安装后可继续使用"
  Pop $DshRadioKeep
  ${NSD_CreateRadioButton} 8u 46u 92% 10u "删除应用数据（不可恢复；会话等 dsh 数据在用户目录 ~/.dsh，不受影响）"
  Pop $DshRadioDel
  ${NSD_SetState} $DshRadioKeep 1
  ${NSD_CreateLabel} 0 80u 100% 24u "提示：点击「取消」可随时退出本次卸载，不会删除任何内容。"
  Pop $DshTmp
  nsDialogs::Show
FunctionEnd

Function un.DshLeaveData
  ${NSD_GetState} $DshRadioDel $DshTmp
  ${If} $DshTmp == 1
    StrCpy $DshDataMode "delete"
  ${Else}
    StrCpy $DshDataMode "keep"
  ${EndIf}
FunctionEnd

; 执行卸载：杀残留进程；仅当用户显式选择删除时清理应用数据目录
!macro customUnInstall
  nsExec::Exec `"$SYSDIR\cmd.exe" /c taskkill /f /im "DeepSeek Harness.exe" /fi "USERNAME eq %USERNAME%"`
  Sleep 500
  ${If} $DshDataMode == "delete"
    RMDir /r "$APPDATA\DeepSeek Harness"
  ${EndIf}
!macroend
!endif
