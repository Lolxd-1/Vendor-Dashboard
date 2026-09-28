Set fso = CreateObject("Scripting.FileSystemObject")
agentDir = fso.GetParentFolderName(WScript.ScriptFullName)
Set ws = CreateObject("Wscript.Shell")
ws.CurrentDirectory = agentDir
' 0 = hidden window, True = wait. Signed-update check for the print agent (see updater.ps1).
ws.Run "powershell -NoProfile -ExecutionPolicy Bypass -File ""updater.ps1""", 0, True
