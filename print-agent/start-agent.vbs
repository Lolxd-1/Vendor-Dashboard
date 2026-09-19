Set fso = CreateObject("Scripting.FileSystemObject")
agentDir = fso.GetParentFolderName(WScript.ScriptFullName)
Set ws = CreateObject("Wscript.Shell")
ws.CurrentDirectory = agentDir
' 0 = hidden window, False = don't wait. Pure PowerShell agent, no Node needed.
ws.Run "powershell -NoProfile -ExecutionPolicy Bypass -File ""agent.ps1""", 0, False
