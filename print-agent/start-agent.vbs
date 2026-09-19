Set fso = CreateObject("Scripting.FileSystemObject")
agentDir = fso.GetParentFolderName(WScript.ScriptFullName)
Set ws = CreateObject("Wscript.Shell")
ws.CurrentDirectory = agentDir
' 0 = hidden window, False = don't wait
ws.Run "node ""server.js""", 0, False
