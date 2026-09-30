Set fso = CreateObject("Scripting.FileSystemObject")
agentDir = fso.GetParentFolderName(WScript.ScriptFullName)
Set ws = CreateObject("Wscript.Shell")
ws.CurrentDirectory = agentDir
' 0 = hidden window, True = wait while the agent runs, so the scheduled task
' shows Running and its 1-minute watchdog only restarts an agent that stopped.
ws.Run "powershell -NoProfile -ExecutionPolicy Bypass -File ""agent.ps1""", 0, True
