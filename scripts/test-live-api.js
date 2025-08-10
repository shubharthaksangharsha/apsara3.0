#!/usr/bin/env node

import readline from 'readline';
import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import fetch from 'node-fetch';
import FormData from 'form-data';
import chalk from 'chalk';
import { marked } from 'marked';
import TerminalRenderer from 'marked-terminal';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure marked for terminal rendering
marked.setOptions({
  renderer: new TerminalRenderer({
    heading: chalk.cyan.bold,
    firstHeading: chalk.magenta.bold,
    strong: chalk.bold,
    em: chalk.italic,
    codespan: chalk.yellow,
    del: chalk.dim.strikethrough,
    link: chalk.blue.underline,
    href: chalk.blue.underline,
    reflowText: true,
    width: 80,
    tab: 2
  })
});

class LiveAPITester {
  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    this.ws = null;
    this.currentSession = null;
    this.config = null;
    this.isConnected = false;
    this.responseQueue = [];
    this.audioRecording = false;
    this.audioProcess = null;
    this.currentUser = null;
    this.currentConversation = null;
    this.baseUrl = 'http://localhost:5000/api';
    
    // Response buffering for complete messages
    this.currentResponse = '';
    this.isResponseInProgress = false;
    
    // Configuration defaults
    this.availableModels = [
      'gemini-2.0-flash-live-001',
      'gemini-2.5-flash-preview-native-audio-dialog',
      'gemini-2.5-flash-exp-native-audio-thinking-dialog'
    ];
    
    this.voices = [
      'auto', 'Puck', 'Charon', 'Kore', 'Fenrir', 
      'Aoede', 'Leda', 'Orus', 'Zephyr'
    ];
    
    this.languages = [
      'en-US', 'en-GB', 'en-AU', 'en-IN',
      'es-US', 'es-ES', 'fr-FR', 'fr-CA',
      'de-DE', 'it-IT', 'pt-BR', 'ja-JP',
      'ko-KR', 'hi-IN', 'ar-XA'
    ];
  }

  /**
   * Render markdown text for terminal display
   */
  renderMarkdown(text) {
    try {
      return marked(text);
    } catch (error) {
      // Fallback to plain text if markdown parsing fails
      return text;
    }
  }

  /**
   * Get file/directory suggestions for autocomplete
   */
  async getFileCompletions(currentPath = './') {
    try {
      // Normalize path
      const basePath = path.resolve(currentPath);
      const items = await fs.promises.readdir(basePath, { withFileTypes: true });
      
      const suggestions = [];
      
      // Add parent directory option if not at root
      if (basePath !== path.parse(basePath).root) {
        suggestions.push({
          type: 'directory',
          name: '..',
          displayName: chalk.blue('📁 .. (parent directory)'),
          path: path.join(basePath, '..')
        });
      }
      
      // Add directories first
      items
        .filter(item => item.isDirectory())
        .sort((a, b) => a.name.localeCompare(b.name))
        .forEach(item => {
          suggestions.push({
            type: 'directory',
            name: item.name,
            displayName: chalk.blue(`📁 ${item.name}/`),
            path: path.join(basePath, item.name)
          });
        });
      
      // Add files
      items
        .filter(item => item.isFile())
        .sort((a, b) => a.name.localeCompare(b.name))
        .forEach(item => {
          const ext = path.extname(item.name);
          let icon = '📄';
          if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) icon = '🖼️';
          else if (['.pdf'].includes(ext)) icon = '📕';
          else if (['.txt', '.md'].includes(ext)) icon = '📝';
          else if (['.js', '.ts', '.py', '.java'].includes(ext)) icon = '💻';
          else if (['.json', '.xml', '.yaml'].includes(ext)) icon = '⚙️';
          
          suggestions.push({
            type: 'file',
            name: item.name,
            displayName: chalk.white(`${icon} ${item.name}`),
            path: path.join(basePath, item.name)
          });
        });
      
      return { suggestions, basePath };
    } catch (error) {
      return { suggestions: [], basePath: currentPath, error: error.message };
    }
  }

  /**
   * Interactive file picker for @ syntax
   */
  async selectFileInteractively(initialPath = './') {
    let currentPath = path.resolve(initialPath);
    
    while (true) {
      console.log(chalk.bold.magenta(`\n🎯 Interactive File Browser`));
      console.log(chalk.magenta('╭─' + '─'.repeat(58) + '─╮'));
      console.log(chalk.magenta('│') + chalk.bold.cyan(` 📂 Current Directory`) + ''.padEnd(37) + chalk.magenta('│'));
      console.log(chalk.magenta('│') + chalk.white(`   ${currentPath}`) + ''.padEnd(58 - currentPath.length) + chalk.magenta('│'));
      console.log(chalk.magenta('├─' + '─'.repeat(58) + '─┤'));
      
      const { suggestions, basePath, error } = await this.getFileCompletions(currentPath);
      
      if (error) {
        console.log(chalk.magenta('│') + chalk.red(` ❌ Error: ${error}`) + ''.padEnd(58 - error.length - 11) + chalk.magenta('│'));
        console.log(chalk.magenta('│') + chalk.yellow(' 💡 Type a path manually or press Enter to cancel') + ''.padEnd(10) + chalk.magenta('│'));
        console.log(chalk.magenta('╰─' + '─'.repeat(58) + '─╯'));
        const input = await this.question(chalk.cyan('Path: '));
        return input.trim() || null;
      }
      
      if (suggestions.length === 0) {
        const emptyMsg = ' 📂 (Empty directory)';
        const hintMsg = ' 💡 Type a filename or go back';
        console.log(chalk.magenta('│') + chalk.yellow(emptyMsg) + ''.padEnd(58 - emptyMsg.length) + chalk.magenta('│'));
        console.log(chalk.magenta('│') + chalk.blue(hintMsg) + ''.padEnd(58 - hintMsg.length) + chalk.magenta('│'));
      } else {
        suggestions.forEach((item, index) => {
          const number = chalk.dim(`${String(index + 1).padStart(2)}. `);
          const content = number + item.displayName;
          // Calculate actual display length without ANSI codes
          const contentLength = content.replace(/\u001b\[[0-9;]*m/g, '').length;
          const maxWidth = 56;
          const displayContent = contentLength > maxWidth ? 
            content.substring(0, content.length - (contentLength - maxWidth) + 3) + '...' : content;
          const actualLength = displayContent.replace(/\u001b\[[0-9;]*m/g, '').length;
          const padding = Math.max(0, 58 - actualLength);
          console.log(chalk.magenta('│') + ' ' + displayContent + ''.padEnd(padding - 1) + chalk.magenta('│'));
        });
      }
      
      console.log(chalk.magenta('├─' + '─'.repeat(58) + '─┤'));
      const optionsText = ' 🔸 Options: Enter number | Type path | Enter=cancel';
      const optionsLength = optionsText.replace(/\u001b\[[0-9;]*m/g, '').length;
      console.log(chalk.magenta('│') + chalk.blue(' 🔸 Options: ') + 
                 chalk.white('Enter number') + chalk.dim(' | ') +
                 chalk.white('Type path') + chalk.dim(' | ') +
                 chalk.gray('Enter=cancel') + ''.padEnd(58 - 51) + chalk.magenta('│'));
      console.log(chalk.magenta('╰─' + '─'.repeat(58) + '─╯'));
      
      const choice = await this.question(chalk.cyan('Select file/folder: '));
      
      if (!choice.trim()) {
        // User pressed Enter without input - cancel
        return null;
      }
      
      const choiceNum = parseInt(choice);
      if (!isNaN(choiceNum) && choiceNum >= 1 && choiceNum <= suggestions.length) {
        // User selected a number
        const selected = suggestions[choiceNum - 1];
        
        if (selected.type === 'directory') {
          // Navigate to directory
          currentPath = selected.path;
          continue;
        } else {
          // File selected
          return selected.path;
        }
      } else {
        // User typed a path
        const inputPath = choice.trim();
        
        if (path.isAbsolute(inputPath)) {
          // Absolute path
          try {
            const stat = await fs.promises.stat(inputPath);
            if (stat.isDirectory()) {
              currentPath = inputPath;
              continue;
            } else {
              // It's a file
              return inputPath;
            }
          } catch (err) {
            // Path doesn't exist, assume it's a new file
            return inputPath;
          }
        } else {
          // Relative path
          const fullPath = path.resolve(currentPath, inputPath);
          try {
            const stat = await fs.promises.stat(fullPath);
            if (stat.isDirectory()) {
              currentPath = fullPath;
              continue;
            } else {
              // It's a file
              return fullPath;
            }
          } catch (err) {
            // Path doesn't exist, assume it's a new file
            return fullPath;
          }
        }
      }
    }
  }

  /**
   * Interactive multiple file selection with navigation
   */
  async selectMultipleFilesInteractively(initialPath = './') {
    let currentPath = path.resolve(initialPath);
    let selectedFiles = [];
    
    while (true) {
      console.log(chalk.bold.magenta(`\n🎯 Multiple File Picker`));
      console.log(chalk.magenta('╭─' + '─'.repeat(58) + '─╮'));
      console.log(chalk.magenta('│') + chalk.bold.cyan(` 📂 Current Directory`) + ''.padEnd(37) + chalk.magenta('│'));
      console.log(chalk.magenta('│') + chalk.white(`   ${currentPath}`) + ''.padEnd(58 - currentPath.length) + chalk.magenta('│'));
      
      if (selectedFiles.length > 0) {
        console.log(chalk.magenta('├─' + '─'.repeat(58) + '─┤'));
        console.log(chalk.magenta('│') + chalk.green(` ✅ Selected Files (${selectedFiles.length})`) + ''.padEnd(58 - ` ✅ Selected Files (${selectedFiles.length})`.length) + chalk.magenta('│'));
        selectedFiles.forEach((file, i) => {
          const relativePath = path.relative(process.cwd(), file);
          const displayPath = relativePath.startsWith('..') ? file : relativePath;
          const displayName = `   ${i + 1}. ${path.basename(displayPath)}`;
          const truncated = displayName.length > 56 ? displayName.substring(0, 53) + '...' : displayName;
          console.log(chalk.magenta('│') + chalk.cyan(truncated) + ''.padEnd(58 - truncated.length) + chalk.magenta('│'));
        });
      }
      
      console.log(chalk.magenta('├─' + '─'.repeat(58) + '─┤'));
      
      const suggestions = this.getFileCompletions(currentPath);
      
      if (suggestions.length === 0) {
        const emptyMsg = ' 📂 (Empty directory)';
        const hintMsg = ' 💡 Type a filename or go back';
        console.log(chalk.magenta('│') + chalk.yellow(emptyMsg) + ''.padEnd(58 - emptyMsg.length) + chalk.magenta('│'));
        console.log(chalk.magenta('│') + chalk.blue(hintMsg) + ''.padEnd(58 - hintMsg.length) + chalk.magenta('│'));
      } else {
        suggestions.forEach((item, index) => {
          const number = chalk.dim(`${String(index + 1).padStart(2)}. `);
          const content = number + item.displayName;
          const contentLength = content.replace(/\u001b\[[0-9;]*m/g, '').length;
          const maxWidth = 56;
          const displayContent = contentLength > maxWidth ? 
            content.substring(0, content.length - (contentLength - maxWidth) + 3) + '...' : content;
          const actualLength = displayContent.replace(/\u001b\[[0-9;]*m/g, '').length;
          const padding = Math.max(0, 58 - actualLength);
          console.log(chalk.magenta('│') + ' ' + displayContent + ''.padEnd(padding - 1) + chalk.magenta('│'));
        });
      }
      
      console.log(chalk.magenta('├─' + '─'.repeat(58) + '─┤'));
      console.log(chalk.magenta('│') + chalk.blue(' 🔸 Options: ') + 
                 chalk.white('Enter number') + chalk.dim(' | ') +
                 chalk.white('Type path') + chalk.dim(' | ') +
                 chalk.white('DONE') + chalk.dim('=finish | ') +
                 chalk.gray('Enter=cancel') + ''.padEnd(4) + chalk.magenta('│'));
      console.log(chalk.magenta('╰─' + '─'.repeat(58) + '─╯'));
      
      const choice = await this.question(chalk.cyan('Select file/folder (or DONE): '));
      
      if (!choice.trim()) {
        // User pressed Enter without input - cancel if no files selected
        return selectedFiles.length > 0 ? selectedFiles : null;
      }
      
      if (choice.toLowerCase() === 'done') {
        return selectedFiles.length > 0 ? selectedFiles : null;
      }
      
      // Check if it's a number selection
      const choiceNum = parseInt(choice);
      if (!isNaN(choiceNum) && choiceNum >= 1 && choiceNum <= suggestions.length) {
        const selectedItem = suggestions[choiceNum - 1];
        const selectedPath = path.join(currentPath, selectedItem.name);
        
        if (selectedItem.type === 'directory') {
          currentPath = selectedPath;
          continue;
        } else {
          // Add file to selection (avoid duplicates)
          if (!selectedFiles.includes(selectedPath)) {
            selectedFiles.push(selectedPath);
            console.log(chalk.green(`✅ Added: `) + chalk.white(selectedItem.name));
          } else {
            console.log(chalk.yellow(`⚠️ Already selected: `) + chalk.white(selectedItem.name));
          }
          continue;
        }
      }
      
      // Handle direct path input
      let targetPath;
      if (path.isAbsolute(choice)) {
        targetPath = choice;
      } else {
        targetPath = path.resolve(currentPath, choice);
      }
      
      try {
        const stats = fs.statSync(targetPath);
        if (stats.isDirectory()) {
          currentPath = targetPath;
        } else if (stats.isFile()) {
          // Add file to selection (avoid duplicates)
          if (!selectedFiles.includes(targetPath)) {
            selectedFiles.push(targetPath);
            console.log(chalk.green(`✅ Added: `) + chalk.white(path.basename(targetPath)));
          } else {
            console.log(chalk.yellow(`⚠️ Already selected: `) + chalk.white(path.basename(targetPath)));
          }
        }
      } catch (error) {
        console.log(chalk.red(`❌ Path not found: ${choice}`));
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  /**
   * Enhanced question method with @ file picker support and input continuation
   */
  async questionWithMultiline(prompt) {
    console.log(chalk.cyan(prompt));
    console.log(chalk.dim('(Press Enter to send, type @ for file picker, or !multiline for multi-line mode)'));
    
    return new Promise((resolve, reject) => {
      let input = '';
      let isMultilineMode = false;
      let isProcessing = false;
      let currentInput = '';
      
      const cleanup = () => {
        this.rl.off('line', handleLine);
      };
      
      const showCurrentInput = () => {
        if (currentInput) {
          process.stdout.write('\r\x1b[K'); // Clear line
          process.stdout.write(chalk.cyan('> ') + currentInput);
        }
      };
      
      const handleLine = async (line) => {
        if (isProcessing) return; // Prevent multiple async operations
        
        try {
          // Handle multiple @ symbols for file selection
          if (line.includes('@')) {
            isProcessing = true;
            let processedLine = line;
            
            // Count only unprocessed @ symbols (not inside quotes)
            const unprocessedAtMatches = line.match(/@(?![^"]*")/g);
            const atCount = unprocessedAtMatches ? unprocessedAtMatches.length : 0;
            
            if (atCount > 0) {
              console.log(chalk.blue(`\n🎯 Found ${atCount} file picker(s) - selecting files...`));
              console.log(chalk.dim('━'.repeat(50)));
              
              try {
                this.rl.pause();
                
                for (let i = 0; i < atCount; i++) {
                  console.log(chalk.cyan(`\n📂 Selecting file ${i + 1} of ${atCount}:`));
                  const selectedFile = await this.selectFileInteractively();
                  
                  if (selectedFile) {
                    const relativePath = path.relative(process.cwd(), selectedFile);
                    const displayPath = relativePath.startsWith('..') ? selectedFile : relativePath;
                    // Replace first unprocessed @ with the selected file
                    processedLine = processedLine.replace(/@(?![^"]*")/, `@"${displayPath}"`);
                    console.log(chalk.green(`✅ File ${i + 1} selected: `) + chalk.white(displayPath));
                  } else {
                    console.log(chalk.yellow(`⏹️ File ${i + 1} selection cancelled - using placeholder`));
                    processedLine = processedLine.replace(/@(?![^"]*")/, '@[cancelled]');
                  }
                }
                
                this.rl.resume();
                console.log(chalk.dim('━'.repeat(50)));
                
                // Check if this line was ONLY @ symbols (no other text)
                const originalLineWithoutFiles = line.replace(/@"[^"]*"/g, ''); // Remove existing @"filename" patterns
                const hasOnlyAtSymbols = originalLineWithoutFiles.trim().replace(/@/g, '').length === 0;
                
                if (hasOnlyAtSymbols) {
                  // This line was just @ symbols, so continue input
                  currentInput = currentInput + processedLine + ' ';
                  console.log(chalk.green('✅ Files selected. Continue typing your message:'));
                  console.log(chalk.cyan('\n' + prompt));
                  console.log(chalk.dim('(Press Enter to send, type @ for file picker, or !multiline for multi-line mode)'));
                  process.stdout.write(chalk.cyan('> ') + currentInput);
                  isProcessing = false;
                  return;
                } else {
                  // This line has other text besides @ symbols, so send it
                  const fullInput = currentInput + processedLine;
                  currentInput = '';
                  cleanup();
                  resolve(fullInput);
                  return;
                }
                
              } catch (error) {
                console.error(chalk.red('❌ File picker error:'), error.message);
                this.rl.resume();
                isProcessing = false;
                return;
              }
            }
          }
          
          // Handle single @ for empty input - Enhanced multiple file picker
          if (line.trim() === '@' && currentInput === '') {
            isProcessing = true;
            console.log(chalk.blue('\n🎯 Enhanced File Picker - Select multiple files'));
            console.log(chalk.dim('━'.repeat(50)));
            
            try {
              this.rl.pause();
              const selectedFiles = await this.selectMultipleFilesInteractively();
              this.rl.resume();
              
              if (selectedFiles && selectedFiles.length > 0) {
                // Build file references
                const fileRefs = selectedFiles.map(file => {
                  const relativePath = path.relative(process.cwd(), file);
                  const displayPath = relativePath.startsWith('..') ? file : relativePath;
                  return `@"${displayPath}"`;
                });
                
                currentInput = fileRefs.join(' ') + ' ';
                console.log(chalk.green(`✅ ${selectedFiles.length} file(s) selected`));
                selectedFiles.forEach((file, i) => {
                  const relativePath = path.relative(process.cwd(), file);
                  const displayPath = relativePath.startsWith('..') ? file : relativePath;
                  console.log(chalk.dim(`   ${i + 1}. `) + chalk.white(displayPath));
                });
                console.log(chalk.blue('\n💡 Continue typing your message or press Enter to send:'));
                console.log(chalk.dim('━'.repeat(50)));
                console.log(chalk.cyan('\n' + prompt));
                console.log(chalk.dim('(Press Enter to send, type @ for file picker, or !multiline for multi-line mode)'));
                process.stdout.write(chalk.cyan('> ') + currentInput);
                isProcessing = false;
                return;
              } else {
                console.log(chalk.yellow('⏹️ File selection cancelled'));
                console.log(chalk.dim('━'.repeat(50)));
                isProcessing = false;
                console.log(chalk.cyan('\n' + prompt));
                console.log(chalk.dim('(Press Enter to send, type @ for file picker, or !multiline for multi-line mode)'));
                return;
              }
            } catch (error) {
              console.error(chalk.red('❌ File picker error:'), error.message);
              this.rl.resume();
              isProcessing = false;
              return;
            }
          }
          
          // Handle regular input - combine with any existing currentInput
          const fullInput = currentInput + line;
          currentInput = ''; // Reset for next input
          
          // Check for special commands
          if (fullInput.trim() === '!multiline' && !isMultilineMode) {
            isMultilineMode = true;
            console.log(chalk.cyan('\n📝 Multi-line mode activated'));
            console.log(chalk.dim('Type your message. Press Enter twice to send, or type "!send" to send immediately.'));
            console.log('');
            return;
          }
          
          if (isMultilineMode) {
            if (line.trim() === '!send' || (line.trim() === '' && input.trim() !== '')) {
              // Send the multi-line message
              cleanup();
              resolve(input.trim());
              return;
            } else if (line.trim() === '!cancel') {
              // Cancel multi-line mode
              console.log(chalk.yellow('⏹️ Multi-line mode cancelled'));
              cleanup();
              resolve('');
              return;
            } else {
              // Add line to input
              input += (input ? '\n' : '') + line;
              return;
            }
          } else {
            // Regular single-line mode - send the full input (including any file prefix)
            cleanup();
            resolve(fullInput);
          }
        } catch (error) {
          cleanup();
          reject(error);
        }
      };
      
      this.rl.on('line', handleLine);
    });
  }

  /**
   * Enhanced question method with markdown support and multi-line input
   */
  async questionMarkdown(prompt, allowMultiline = false) {
    if (allowMultiline) {
      console.log(chalk.cyan(prompt));
      console.log(chalk.dim('(Use Ctrl+D when finished, or type "---END---" on a new line)'));
      console.log('');
      
      return new Promise((resolve) => {
        let input = '';
        const onLine = (line) => {
          if (line.trim() === '---END---') {
            this.rl.off('line', onLine);
            resolve(input.trim());
          } else {
            input += line + '\n';
          }
        };
        
        this.rl.on('line', onLine);
      });
    } else {
      return this.question(prompt);
    }
  }

  /**
   * Show sidebar with user and conversation information
   */
  showSidebar() {
    const sidebarWidth = 49;
    console.log('\n' + chalk.blue('┌─ 👤 User Information ' + '─'.repeat(sidebarWidth - 21) + '┐'));
    
    if (this.currentUser) {
      const name = ` Name: ${this.currentUser.fullName || this.currentUser.email || 'Not set'}`;
      const email = ` Email: ${this.currentUser.email || 'N/A'}`;
      const id = ` ID: ${this.currentUser.id || this.currentUser._id}`;
      
      console.log(chalk.blue('│') + chalk.white(name.padEnd(sidebarWidth)) + chalk.blue('│'));
      console.log(chalk.blue('│') + chalk.white(email.padEnd(sidebarWidth)) + chalk.blue('│'));
      console.log(chalk.blue('│') + chalk.white(id.padEnd(sidebarWidth)) + chalk.blue('│'));
    } else {
      const notLoggedIn = ' Not logged in';
      console.log(chalk.blue('│') + chalk.red(notLoggedIn.padEnd(sidebarWidth)) + chalk.blue('│'));
    }
    
    console.log(chalk.blue('├─ 💬 Conversation Info ' + '─'.repeat(sidebarWidth - 23) + '┤'));
    if (this.currentConversation) {
      const title = ` Title: ${this.currentConversation.title || 'Untitled'}`;
      let convId = ` ID: ${this.currentConversation.conversationId}`;
      if (convId.length > sidebarWidth) {
        convId = ` ID: ${this.currentConversation.conversationId.substring(0, sidebarWidth - 8)}...`;
      }
      
      console.log(chalk.blue('│') + chalk.white(title.padEnd(sidebarWidth)) + chalk.blue('│'));
      console.log(chalk.blue('│') + chalk.white(convId.padEnd(sidebarWidth)) + chalk.blue('│'));
    } else {
      const noConv = ' No conversation selected';
      console.log(chalk.blue('│') + chalk.red(noConv.padEnd(sidebarWidth)) + chalk.blue('│'));
    }
    
    console.log(chalk.blue('├─ 🤖 Session Info ' + '─'.repeat(sidebarWidth - 17) + '┤'));
    const model = ` Model: ${this.config?.model || 'Not configured'}`;
    const mode = ` Mode: ${this.config?.responseMode || 'Not set'}`;
    
    console.log(chalk.blue('│') + chalk.white(model.padEnd(sidebarWidth)) + chalk.blue('│'));
    console.log(chalk.blue('│') + chalk.white(mode.padEnd(sidebarWidth)) + chalk.blue('│'));
    
    if (this.currentSession) {
      let session = ` Session: ${this.currentSession}`;
      if (session.length > sidebarWidth) {
        session = ` Session: ${this.currentSession.substring(0, sidebarWidth - 12)}...`;
      }
      const status = ` Status: ${this.isConnected ? '🟢 Connected' : '🔴 Disconnected'}`;
      
      console.log(chalk.blue('│') + chalk.white(session.padEnd(sidebarWidth)) + chalk.blue('│'));
      console.log(chalk.blue('│') + chalk.white(status.padEnd(sidebarWidth)) + chalk.blue('│'));
    } else {
      const noSession = ' No active session';
      console.log(chalk.blue('│') + chalk.red(noSession.padEnd(sidebarWidth)) + chalk.blue('│'));
    }
    console.log(chalk.blue('└' + '─'.repeat(sidebarWidth + 1) + '┘'));
  }

  /**
   * Display formatted output with colors and markdown
   */
  displayFormatted(text, type = 'info') {
    const colors = {
      info: chalk.blue,
      success: chalk.green,
      warning: chalk.yellow,
      error: chalk.red,
      ai: chalk.magenta,
      user: chalk.cyan,
      system: chalk.gray
    };
    
    const color = colors[type] || colors.info;
    
    // If it looks like markdown, render it
    if (text.includes('*') || text.includes('#') || text.includes('`') || text.includes('**')) {
      try {
        const rendered = this.renderMarkdown(text);
        console.log(rendered);
      } catch (error) {
        console.log(color(text));
      }
    } else {
      console.log(color(text));
    }
  }

  /**
   * Start the Live API tester
   */
  async start() {
    console.clear();
    console.log(chalk.bold.magenta('🎙️ Apsara Live API Tester v3.0'));
    console.log(chalk.magenta('═'.repeat(60)));
    console.log(chalk.bold.cyan('🚀 Real-time AI conversations with multimodal support'));
    console.log(chalk.cyan('   📎 File attachments • 🎨 Markdown rendering • 🔄 Live streaming'));
    console.log(chalk.dim('──────────────────────────────────────────────────────────'));
    console.log('');
    
    try {
      await this.showMainMenu();
    } catch (error) {
      console.error(chalk.red('❌ Error:'), error.message);
    } finally {
      this.cleanup();
    }
  }

  /**
   * Show main menu
   */
  async showMainMenu() {
    // Show current user status
    if (this.currentUser) {
      console.log(chalk.green(`\n👤 Logged in as: ${this.currentUser.fullName || this.currentUser.email}`));
      if (this.currentConversation) {
        console.log(chalk.blue(`💬 Current conversation: ${this.currentConversation.title || this.currentConversation.conversationId}`));
      }
    }
    
    console.log(chalk.bold.cyan('\n🎯 Main Menu'));
    const boxWidth = 50;
    console.log(chalk.cyan('╭─' + '─'.repeat(boxWidth) + '─╮'));
    
    const option1 = ' 1. ⚙️  Configure Live API Session';
    console.log(chalk.cyan('│') + chalk.white(' 1. ') + chalk.yellow('⚙️  Configure Live API Session') + ''.padEnd(boxWidth - option1.length + 1) + chalk.cyan('│'));
    
    const option2 = ' 2. 💬 Interactive Chat Session';
    console.log(chalk.cyan('│') + chalk.white(' 2. ') + chalk.magenta('💬 Interactive Chat Session') + ''.padEnd(boxWidth - option2.length + 1) + chalk.cyan('│'));
    
    if (this.currentUser) {
      const option3 = ' 3. 🚪 Logout';
      console.log(chalk.cyan('│') + chalk.white(' 3. ') + chalk.red('🚪 Logout') + ''.padEnd(boxWidth - option3.length + 1) + chalk.cyan('│'));
      
      const option4 = ' 4. ❌ Exit';
      console.log(chalk.cyan('│') + chalk.white(' 4. ') + chalk.gray('❌ Exit') + ''.padEnd(boxWidth - option4.length + 1) + chalk.cyan('│'));
    } else {
      const option3 = ' 3. ❌ Exit';
      console.log(chalk.cyan('│') + chalk.white(' 3. ') + chalk.gray('❌ Exit') + ''.padEnd(boxWidth - option3.length + 1) + chalk.cyan('│'));
    }
    console.log(chalk.cyan('╰─' + '─'.repeat(boxWidth) + '─╯'));
    console.log('');

    const maxChoice = this.currentUser ? 4 : 3;
    const choice = await this.question(`Choose option (1-${maxChoice}): `);
    
    switch (choice) {
      case '1':
        await this.configureLiveSession();
        break;
      case '2':
        await this.interactiveChatSession();
        break;
      case '3':
        if (this.currentUser) {
          // Logout
          this.logout();
          console.log(chalk.blue('\nPress any key to continue...'));
          await this.question('');
          await this.showMainMenu();
        } else {
          // Exit
          console.log(chalk.green('👋 Goodbye!'));
          return;
        }
        break;
      case '4':
        if (this.currentUser) {
          console.log(chalk.green('👋 Goodbye!'));
          return;
        } else {
          console.log(chalk.red('Invalid choice. Please try again.'));
          await this.showMainMenu();
        }
        break;
      default:
        console.log(chalk.red('Invalid choice. Please try again.'));
        await this.showMainMenu();
    }
  }

  /**
   * Configure Live API session
   */
  async configureLiveSession() {
    console.log('\n⚙️ Live API Configuration');
    console.log('=========================');
    
    // Check if user is already logged in
    if (this.currentUser) {
      console.log(`👤 Currently logged in as: ${this.currentUser.fullName || this.currentUser.email}`);
      console.log('\n🔄 User Options:');
      console.log('1. Continue with current user');
      console.log('2. Logout and select different user');
      
      const userChoice = await this.question('Choose option (1-2, default: 1): ') || '1';
      
      if (userChoice === '2') {
        this.logout();
      }
    }
    
    // Step 1: User Selection/Creation (only if not logged in)
    if (!this.currentUser) {
      await this.selectOrCreateUser();
      
      if (!this.currentUser) {
        console.log('❌ User selection cancelled. Returning to main menu.');
        await this.showMainMenu();
        return;
      }
    }
    
    // Step 2: Conversation Selection/Creation
    if (this.currentUser) {
      console.log(`\n💬 Conversation Management for ${this.currentUser.fullName || this.currentUser.email}`);
      console.log('==============================================');
    }
    await this.selectOrCreateConversation();
    
    if (!this.currentConversation) {
      console.log('❌ Conversation selection cancelled. Returning to main menu.');
      await this.showMainMenu();
      return;
    }
    
    // Step 3: Model selection
    console.log('\n🤖 Available Models:');
    this.availableModels.forEach((model, index) => {
      console.log(`${index + 1}. ${model}`);
    });
    
    const modelChoice = await this.question(`Choose model (1-${this.availableModels.length}, default: 1): `) || '1';
    const selectedModel = this.availableModels[parseInt(modelChoice) - 1] || this.availableModels[0];
    
    // Step 4: Response modality (TEXT only for now)
    console.log('\n📡 Response Modality:');
    console.log('1. TEXT - AI responds with text only');
    console.log('Note: Audio support will be added later');
    
    const responseModality = 'TEXT';
    
    // Step 5: Media resolution
    console.log('\n🎥 Media Resolution:');
    console.log('1. LOW - Lower quality, faster processing');
    console.log('2. MEDIUM - Balanced quality and speed (default)');
    console.log('3. HIGH - High quality, slower processing');
    
    const resolutionChoice = await this.question('Choose resolution (1-3, default: 2): ') || '2';
    let mediaResolution = 'MEDIUM';
    switch (resolutionChoice) {
      case '1': mediaResolution = 'LOW'; break;
      case '2': mediaResolution = 'MEDIUM'; break;
      case '3': mediaResolution = 'HIGH'; break;
    }
    
    // Store configuration
    this.config = {
      model: selectedModel,
      responseModality,
      mediaResolution,
      voiceConfig: null, // No voice config for text mode
      conversationId: this.currentConversation.conversationId,
      userId: this.currentUser.id || this.currentUser._id,
      loadConversationContext: this.currentConversation.hasMessages || false
    };
    
    // Display configuration summary
    console.log('\n📋 Configuration Summary:');
    console.log('========================');
    console.log(`🤖 Model: ${this.config.model}`);
    console.log(`📡 Response Mode: ${this.config.responseModality}`);
    console.log(`🎥 Media Resolution: ${this.config.mediaResolution}`);
    console.log(`💬 Conversation: ${this.currentConversation.conversationId}`);
    console.log(`👤 User: ${this.currentUser.id || this.currentUser._id}`);
    console.log(`🔗 Load Context: ${this.config.loadConversationContext ? 'Yes' : 'No'}`);
    
    console.log('\n✅ Configuration saved! You can now start a chat session.');
    await this.showMainMenu();
  }

  /**
   * Logout current user
   */
  logout() {
    if (this.currentUser) {
      console.log(chalk.yellow('\n🔄 Logging out...'));
      console.log(chalk.green(`👋 Goodbye ${this.currentUser.fullName || this.currentUser.email}`));
      
      // Disconnect any active WebSocket session
      if (this.isConnected) {
        console.log(chalk.blue('🔌 Disconnecting from Live API session...'));
        this.disconnect();
      }
      
      // Clear all session data
      this.currentUser = null;
      this.currentConversation = null;
      this.currentSession = null;
      this.config = null;
      
      console.log(chalk.green('✅ Logged out successfully'));
      console.log(chalk.dim('All session data cleared'));
    } else {
      console.log(chalk.yellow('⚠️ No user currently logged in'));
    }
  }

  /**
   * Select or create user
   */
  async selectOrCreateUser() {
    console.log('\n👤 User Management');
    console.log('==================');
    console.log('1. Select existing user');
    console.log('2. Create new user');
    console.log('3. Cancel');
    
    const choice = await this.question('Choose option (1-3): ');
    
    switch (choice) {
      case '1':
        await this.selectExistingUser();
        break;
      case '2':
        await this.createNewUser();
        break;
      case '3':
        console.log('❌ User selection cancelled');
        return;
      default:
        console.log('Invalid choice. Please try again.');
        await this.selectOrCreateUser();
    }
  }

  /**
   * Select existing user from database
   */
  async selectExistingUser() {
    try {
      console.log('\n🔍 Fetching users...');
      
      const response = await fetch(`${this.baseUrl}/users`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      const users = data.data || [];
      
      if (users.length === 0) {
        console.log('\n📭 No users found in the database.');
        console.log('💡 You can create a new user or login with existing credentials.');
        
        console.log('\n🔍 User Selection');
        console.log('=================');
        console.log('1. Create a new user');
        console.log('2. Enter existing user credentials to login');
        console.log('3. Cancel');
        
        const choice = await this.question('Choose option (1-3): ');
        
        switch (choice) {
          case '1':
            await this.createNewUser();
            break;
          case '2':
            await this.loginExistingUser();
            break;
          case '3':
            console.log('❌ User selection cancelled.');
            return;
          default:
            console.log('Invalid choice. Please try again.');
            await this.selectExistingUser();
        }
        
        return;
      }
      
      console.log('\n👥 Available Users:');
      console.log('===================');
      users.forEach((user, index) => {
        const lastLogin = user.usage?.lastLogin ? new Date(user.usage.lastLogin).toLocaleDateString() : 'Never';
        const status = user.isEmailVerified ? '✅' : '⚠️';
        console.log(`${index + 1}. ${status} ${user.fullName} (${user.email}) - Last login: ${lastLogin}`);
      });
      
      console.log(`${users.length + 1}. Create new user`);
      console.log(`${users.length + 2}. Login with credentials`);
      
      const userChoice = await this.question(`Select user (1-${users.length + 2}): `);
      const selectedIndex = parseInt(userChoice) - 1;
      
      if (selectedIndex >= 0 && selectedIndex < users.length) {
        // User selected an existing user
        const selectedUser = users[selectedIndex];
        console.log(`\n🔐 Selected: ${selectedUser.fullName} (${selectedUser.email})`);
        
        const password = await this.question('Enter password: ');
        
        // Login with selected user
        const loginResponse = await fetch(`${this.baseUrl}/users/login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            email: selectedUser.email,
            password
          })
        });
        
        const loginData = await loginResponse.json();
        
        if (!loginResponse.ok) {
          throw new Error(loginData.details || loginData.message || loginData.error || 'Login failed');
        }
        
        // Handle the login response structure
        if (loginData.success && loginData.data && loginData.data.user) {
          this.currentUser = loginData.data.user;
          console.log(`✅ Logged in as: ${this.currentUser.fullName || this.currentUser.email}`);
        } else {
          throw new Error(`Invalid login response structure. Response: ${JSON.stringify(loginData)}`);
        }
        
      } else if (selectedIndex === users.length) {
        // Create new user
        await this.createNewUser();
      } else if (selectedIndex === users.length + 1) {
        // Login with credentials
        await this.loginExistingUser();
      } else {
        console.log('Invalid choice. Please try again.');
        await this.selectExistingUser();
      }
      
    } catch (error) {
      console.error('❌ Error fetching users:', error.message);
      
      console.log('\n🔍 User Selection (Fallback)');
      console.log('============================');
      console.log('⚠️ Could not fetch user list from database.');
      console.log('💡 For testing, you can either:');
      console.log('1. Create a new user');
      console.log('2. Enter existing user credentials to login');
      console.log('3. Cancel');
      
      const retryChoice = await this.question('Choose option (1-3): ');
      
      switch (retryChoice) {
        case '1':
          await this.createNewUser();
          break;
        case '2':
          await this.loginExistingUser();
          break;
        case '3':
          console.log('❌ User selection cancelled.');
          break;
        default:
          console.log('Invalid choice. Please try again.');
          await this.selectExistingUser();
      }
    }
  }
  
  /**
   * Login with existing user credentials
   */
  async loginExistingUser() {
    console.log('\n🔐 Login Existing User');
    console.log('======================');
    
    const email = await this.question('Enter email: ');
    const password = await this.question('Enter password: ');
    
    if (!email || !password) {
      console.log('❌ Email and password are required');
      const retryChoice = await this.question('Would you like to try again? (y/n): ');
      if (retryChoice.toLowerCase() === 'y') {
        await this.loginExistingUser();
      }
      return;
    }
    
    try {
      console.log('🔄 Logging in...');
      
      const response = await fetch(`${this.baseUrl}/users/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email,
          password
        })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.details || data.message || data.error || 'Login failed');
      }
      
      // Handle the login response structure
      if (data.success && data.data && data.data.user) {
        this.currentUser = data.data.user;
        console.log(`✅ Logged in as: ${this.currentUser.fullName || this.currentUser.email}`);
      } else {
        throw new Error(`Invalid login response structure. Response: ${JSON.stringify(data)}`);
      }
      
    } catch (error) {
      console.error('❌ Login error:', error.message);
      
      const retryChoice = await this.question('Would you like to try again? (y/n): ');
      if (retryChoice.toLowerCase() === 'y') {
        await this.loginExistingUser();
      }
    }
  }

  /**
   * Create new user
   */
  async createNewUser() {
    console.log('\n✨ Create New User');
    console.log('==================');
    
    const fullName = await this.question('Enter full name: ');
    const email = await this.question('Enter email: ');
    const password = await this.question('Enter password (min 6 characters): ');
    
    if (!fullName || !email || !password) {
      console.log('❌ All fields are required');
      const retryChoice = await this.question('Would you like to try again? (y/n): ');
      if (retryChoice.toLowerCase() === 'y') {
        await this.createNewUser();
      }
      return;
    }
    
    if (password.length < 6) {
      console.log('❌ Password must be at least 6 characters');
      await this.createNewUser();
      return;
    }
    
    try {
      console.log('🔄 Creating user...');
      
      const response = await fetch(`${this.baseUrl}/users/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          fullName,
          email,
          password,
          acceptTerms: true
        })
      });
      
      const data = await response.json();
      
      console.log('🔍 Registration response:', JSON.stringify(data, null, 2));
      
      if (!response.ok) {
        const errorMsg = data.details || data.message || data.error || `Registration failed (${response.status})`;
        throw new Error(errorMsg);
      }
      
      console.log('✅ User registered successfully!');
      console.log('📧 Please check your email for OTP verification');
      
      const otp = await this.question('Enter OTP from email: ');
      
      const verifyResponse = await fetch(`${this.baseUrl}/users/verify-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email,
          otp
        })
      });
      
      const verifyData = await verifyResponse.json();
      
      if (!verifyResponse.ok) {
        throw new Error(verifyData.details || verifyData.error || 'Email verification failed');
      }
      
      console.log('✅ Email verified successfully!');
      
      // Login to get user data
      const loginResponse = await fetch(`${this.baseUrl}/users/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email,
          password
        })
      });
      
      const loginData = await loginResponse.json();
      
      if (!loginResponse.ok) {
        throw new Error(loginData.details || loginData.error || loginData.message || 'Login failed');
      }
      
      // Handle the login response structure
      if (loginData.success && loginData.data && loginData.data.user) {
        this.currentUser = loginData.data.user;
        console.log(`✅ Logged in as: ${this.currentUser.fullName || this.currentUser.email}`);
      } else {
        throw new Error(`Invalid login response structure. Response: ${JSON.stringify(loginData)}`);
      }
      
    } catch (error) {
      console.error('❌ Error creating user:', error.message);
      
      const retryChoice = await this.question('Would you like to try again? (y/n): ');
      if (retryChoice.toLowerCase() === 'y') {
        await this.createNewUser();
      }
    }
  }

  /**
   * Select or create conversation
   */
  async selectOrCreateConversation() {
    console.log('\n💬 Conversation Management');
    console.log('==========================');
    console.log('1. Select existing conversation');
    console.log('2. Create new conversation');
    console.log('3. Cancel');
    
    const choice = await this.question('Choose option (1-3): ');
    
    switch (choice) {
      case '1':
        await this.selectExistingConversation();
        break;
      case '2':
        await this.createNewConversation();
        break;
      case '3':
        console.log('❌ Conversation selection cancelled');
        return;
      default:
        console.log('Invalid choice. Please try again.');
        await this.selectOrCreateConversation();
    }
  }

  /**
   * Select existing conversation
   */
  async selectExistingConversation() {
    try {
      console.log('\n🔍 Fetching conversations...');
      
      const userId = this.currentUser.id || this.currentUser._id;
      const response = await fetch(`${this.baseUrl}/conversations/${userId}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      console.log('🔍 Conversations response:', JSON.stringify(data, null, 2));
      
      const conversations = data.conversations || data.data || [];
      
      if (conversations.length === 0) {
        console.log('📭 No conversations found for this user.');
        console.log('💡 This might be because:');
        console.log('   • This is a new user with no conversations yet');
        console.log('   • Previous conversations were created with a different user ID format');
        const createChoice = await this.question('Would you like to create a new conversation? (y/n): ');
        if (createChoice.toLowerCase() === 'y') {
          await this.createNewConversation();
        }
        return;
      }
      
      console.log('\n💬 Available Conversations:');
      console.log('============================');
      conversations.forEach((conv, index) => {
        const title = conv.title || `Conversation ${conv.conversationId.substring(0, 8)}...`;
        const messageCount = conv.stats?.totalMessages || 0;
        const lastUpdated = conv.updatedAt ? new Date(conv.updatedAt).toLocaleDateString() : 'Unknown';
        console.log(`${index + 1}. ${title} (${messageCount} messages, updated: ${lastUpdated})`);
      });
      
      const convChoice = await this.question(`Select conversation (1-${conversations.length}): `);
      const selectedIndex = parseInt(convChoice) - 1;
      
      if (selectedIndex >= 0 && selectedIndex < conversations.length) {
        this.currentConversation = conversations[selectedIndex];
        this.currentConversation.hasMessages = (conversations[selectedIndex].stats?.totalMessages || 0) > 0;
        console.log(`✅ Selected conversation: ${this.currentConversation.title || this.currentConversation.conversationId}`);
        
        if (this.currentConversation.hasMessages) {
          console.log(`📚 This conversation has ${this.currentConversation.stats.totalMessages} messages that will be loaded as context`);
        }
      } else {
        console.log('❌ Invalid selection');
        await this.selectExistingConversation();
      }
      
    } catch (error) {
      console.error('❌ Error fetching conversations:', error.message);
      
      const retryChoice = await this.question('Would you like to try again? (y/n): ');
      if (retryChoice.toLowerCase() === 'y') {
        await this.selectExistingConversation();
      }
    }
  }

  /**
   * Create new conversation
   */
  async createNewConversation() {
    console.log('\n✨ Create New Conversation');
    console.log('==========================');
    
    const title = await this.question('Enter conversation title (optional): ') || 'Live API Chat';
    const systemInstruction = await this.question('Enter system instruction (optional): ') || 'You are a helpful assistant.';
    
    try {
      console.log('🔄 Creating conversation...');
      
      const response = await fetch(`${this.baseUrl}/conversations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          userId: this.currentUser.id || this.currentUser._id,
          title,
          config: {
            systemInstruction: systemInstruction || 'You are a helpful assistant.'
          }
        })
      });
      
      const data = await response.json();
      
      console.log('🔍 Conversation creation response:', JSON.stringify(data, null, 2));
      
      if (!response.ok) {
        const errorMsg = data.details || data.message || data.error || `Failed to create conversation (${response.status})`;
        throw new Error(errorMsg);
      }
      
      // Handle conversation response structure
      if (data.success && data.data) {
        this.currentConversation = data.data;
        this.currentConversation.hasMessages = false;
        console.log(`✅ Created conversation: ${this.currentConversation.title}`);
        console.log(`📝 Conversation ID: ${this.currentConversation.conversationId}`);
      } else {
        throw new Error(`Invalid conversation response structure: ${JSON.stringify(data)}`);
      }
      
    } catch (error) {
      console.error('❌ Error creating conversation:', error.message);
      
      const retryChoice = await this.question('Would you like to try again? (y/n): ');
      if (retryChoice.toLowerCase() === 'y') {
        await this.createNewConversation();
      }
    }
  }

  /**
   * Quick text test with default configuration
   */
  async quickTextTest() {
    console.log('\n📝 Quick Text Test');
    console.log('==================');
    console.log('This will use default settings with database integration');
    
    // Step 1: Select/Create User (only if not already logged in)
    if (!this.currentUser) {
      await this.selectOrCreateUser();
      if (!this.currentUser) {
        console.log('❌ User selection required for quick test');
        await this.showMainMenu();
        return;
      }
    } else {
      console.log(`👤 Using current user: ${this.currentUser.fullName || this.currentUser.email}`);
    }
    
    // Step 2: Create a temporary conversation for quick test
    console.log('\n🔄 Creating temporary conversation for quick test...');
    try {
      const response = await fetch(`${this.baseUrl}/conversations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          userId: this.currentUser.id || this.currentUser._id,
          title: 'Quick Text Test',
          config: {
            systemInstruction: 'You are a helpful assistant for a quick test.'
          }
        })
      });
      
      const data = await response.json();
      
      console.log('🔍 Quick test conversation response:', JSON.stringify(data, null, 2));
      
      if (!response.ok) {
        const errorMsg = data.details || data.message || data.error || `Failed to create conversation (${response.status})`;
        throw new Error(errorMsg);
      }
      
      // Handle conversation response structure
      if (data.success && data.data) {
        this.currentConversation = data.data;
        this.currentConversation.hasMessages = false;
        console.log(`✅ Created test conversation: ${this.currentConversation.conversationId}`);
      } else {
        throw new Error(`Invalid conversation response structure: ${JSON.stringify(data)}`);
      }
      
    } catch (error) {
      console.error('❌ Error creating test conversation:', error.message);
      await this.showMainMenu();
      return;
    }
    
    // Step 3: Configure and connect
    this.config = {
      model: 'gemini-2.0-flash-live-001',
      responseModality: 'TEXT',
      mediaResolution: 'MEDIUM',
      voiceConfig: null,
      conversationId: this.currentConversation.conversationId,
      userId: this.currentUser.id || this.currentUser._id,
      loadConversationContext: false
    };
    
    await this.connectToWebSocket();
    
    if (this.isConnected) {
      console.log(chalk.blue('\n💡 You can use @ syntax to attach files:'));
      console.log(chalk.dim('   Example: "Analyze @README.md and tell me about this project"'));
      console.log(chalk.dim('   Multiple: "Compare @file1.txt and @file2.txt"'));
      console.log('');
      const message = await this.questionWithMultiline('Enter your message (or try @filename): ');
      if (message.trim()) {
      await this.sendTextMessage(message);
      }
      
      // Wait for response
      console.log('⏳ Waiting for response...');
      await this.waitForResponse();
      
      this.disconnect();
    }
    
    await this.showMainMenu();
  }



  /**
   * Interactive chat session with enhanced UI and file attachments
   */
  async interactiveChatSession() {
    console.log(chalk.bold.magenta('\n💬 Interactive Chat Session'));
    console.log(chalk.magenta('='.repeat(40)));
    
    if (!this.config || !this.currentUser || !this.currentConversation) {
      console.log(chalk.yellow('⚠️ No configuration found. Please configure first.'));
      console.log(chalk.blue('💡 Go to option 1 to configure Live API session'));
      await this.showMainMenu();
      return;
    }
    
    await this.connectToWebSocket();
    
    if (!this.isConnected) {
      await this.showMainMenu();
      return;
    }
    
    // Clear screen and show enhanced layout
    console.clear();
    console.log(chalk.bold.cyan('💬 Apsara Live Chat Session'));
    console.log(chalk.cyan('═'.repeat(60)));
    console.log(chalk.bold.magenta('🔮 AI-Powered Conversations with File Intelligence'));
    console.log(chalk.dim('────────────────────────────────────────────────────────────'));
    
    // Show sidebar with user and conversation info
    this.showSidebar();
    
    console.log(chalk.bold.magenta('\n🎯 Quick Commands & Features'));
    const featuresWidth = 60;
    console.log(chalk.magenta('╭─' + '─'.repeat(featuresWidth) + '─╮'));
    
    const instantActions = ' ✨ Instant Actions';
    console.log(chalk.magenta('│') + chalk.green(instantActions) + ''.padEnd(featuresWidth - instantActions.length + 1) + chalk.magenta('│'));
    
    const enterText = '  • Press Enter to send message';
    console.log(chalk.magenta('│') + '  • ' + chalk.white('Press Enter') + chalk.dim(' to send message') + ''.padEnd(featuresWidth - enterText.length + 1) + chalk.magenta('│'));
    
    const atText = '  • Type "@" for multiple file picker';
    console.log(chalk.magenta('│') + '  • ' + chalk.yellow('Type "@"') + chalk.dim(' for multiple file picker') + ''.padEnd(featuresWidth - atText.length + 1) + chalk.magenta('│'));
    
    const multilineText = '  • Type "!multiline" for multi-line input';
    console.log(chalk.magenta('│') + '  • ' + chalk.blue('Type "!multiline"') + chalk.dim(' for multi-line input') + ''.padEnd(featuresWidth - multilineText.length + 1) + chalk.magenta('│'));
    
    const fileAttachments = ' 📁 File Attachments';
    console.log(chalk.magenta('│') + fileAttachments + ''.padEnd(featuresWidth - fileAttachments.length + 1) + chalk.magenta('│'));
    
    const manualText = '  • Manual: "Analyze @README.md"';
    console.log(chalk.magenta('│') + '  • ' + chalk.yellow('Manual: ') + chalk.dim('"Analyze @README.md"') + ''.padEnd(featuresWidth - manualText.length + 1) + chalk.magenta('│'));
    
    const multipleText = '  • Multiple: "Compare @ @ and explain differences"';
    console.log(chalk.magenta('│') + '  • ' + chalk.yellow('Multiple: ') + chalk.dim('"Compare @ @ and explain differences"') + ''.padEnd(featuresWidth - multipleText.length + 1) + chalk.magenta('│'));
    
    const utilityCommands = ' 🛠️ Utility Commands';
    console.log(chalk.magenta('│') + utilityCommands + ''.padEnd(featuresWidth - utilityCommands.length + 1) + chalk.magenta('│'));
    
    const sidebarText = '  • !sidebar - Show session info';
    console.log(chalk.magenta('│') + '  • ' + chalk.blue('!sidebar') + chalk.dim(' - Show session info') + ''.padEnd(featuresWidth - sidebarText.length + 1) + chalk.magenta('│'));
    
    const helpText = '  • !help - File attachment guide';
    console.log(chalk.magenta('│') + '  • ' + chalk.blue('!help') + chalk.dim(' - File attachment guide') + ''.padEnd(featuresWidth - helpText.length + 1) + chalk.magenta('│'));
    
    const typesText = '  • !types - Supported file formats';
    console.log(chalk.magenta('│') + '  • ' + chalk.blue('!types') + chalk.dim(' - Supported file formats') + ''.padEnd(featuresWidth - typesText.length + 1) + chalk.magenta('│'));
    
    const quitText = '  • !quit - End chat session';
    console.log(chalk.magenta('│') + '  • ' + chalk.red('!quit') + chalk.dim(' - End chat session') + ''.padEnd(featuresWidth - quitText.length + 1) + chalk.magenta('│'));
    
    console.log(chalk.magenta('╰─' + '─'.repeat(featuresWidth) + '─╯'));
    console.log('');
    
    let chatting = true;
    while (chatting && this.isConnected) {
      const input = await this.questionWithMultiline('\n' + chalk.bold.cyan('👤 You') + chalk.dim(' › '));
      
      switch (input.toLowerCase()) {
        case '!quit':
          chatting = false;
          console.log(chalk.yellow('👋 Ending chat session...'));
          break;
        case '!config':
          this.showCurrentConfig();
          break;
        case '!help':
          this.showFileAttachmentHelp();
          break;
        case '!types':
          this.showSupportedFileTypes();
          break;
        case '!sidebar':
          this.showSidebar();
          break;
        default:
          if (input.trim()) {
            // Check for file attachments and show preview
            const parsed = this.parseFileAttachments(input);
            if (parsed.files.length > 0) {
              console.log(chalk.yellow(`📎 Detected ${parsed.files.length} file(s): `) + 
                         chalk.white(parsed.files.map(f => f.path).join(', ')));
            }
            
            await this.sendTextMessage(input);
            console.log(chalk.blue('⏳ Waiting for response...'));
            await this.waitForResponse();
          }
          break;
      }
    }
    
    this.disconnect();
    await this.showMainMenu();
  }



  /**
   * Connect to WebSocket server
   */
  async connectToWebSocket() {
    const wsUrl = 'ws://localhost:5000/live';
    
    console.log(`\n🔌 Connecting to ${wsUrl}...`);
    
    try {
      this.ws = new WebSocket(wsUrl);
      
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Connection timeout'));
        }, 10000);
        
        this.ws.on('open', () => {
          clearTimeout(timeout);
          console.log('✅ Connected to Live API WebSocket');
          this.isConnected = true;
          resolve();
        });
        
        this.ws.on('error', (error) => {
          clearTimeout(timeout);
          console.error('❌ WebSocket connection error:', error.message);
          reject(error);
        });
      });
      
      // Set up message handlers
      this.ws.on('message', (data) => this.handleWebSocketMessage(data));
      this.ws.on('close', () => {
        console.log('🔌 WebSocket connection closed');
        this.isConnected = false;
      });
      
      // Create Live API session
      await this.createLiveSession();
      
    } catch (error) {
      console.error('❌ Failed to connect:', error.message);
      console.log('💡 Make sure Apsara backend is running on port 5000');
      this.isConnected = false;
    }
  }

  /**
   * Create Live API session
   */
  async createLiveSession() {
    const sessionMessage = {
      type: 'create_session',
      data: {
        model: this.config.model,
        config: {
          responseModalities: [this.config.responseModality],
          realtimeInputConfig: {
            mediaResolution: this.config.mediaResolution
          },
          ...(this.config.voiceConfig && {
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: this.config.voiceConfig.voiceName
                }
              }
            }
          }),
          ...(this.config.responseModality === 'AUDIO' && {
            outputAudioTranscription: {}
          })
        },
        ...(this.config.conversationId && {
          conversationId: this.config.conversationId,
          userId: this.config.userId,
          loadConversationContext: this.config.loadConversationContext
        })
      }
    };
    
    console.log('📤 Creating Live API session...');
    this.ws.send(JSON.stringify(sessionMessage));
    
    // Wait for session creation confirmation
    await this.waitForSessionCreation();
  }

  /**
   * Handle WebSocket messages
   */
  handleWebSocketMessage(data) {
    try {
      const message = JSON.parse(data.toString());
      this.responseQueue.push(message);
      
      // Log different message types
      switch (message.type) {
        case 'connection':
          console.log(`💚 ${message.message}`);
          break;
        case 'session_created':
          console.log(`🎉 Session created: ${message.sessionId}`);
          if (message.geminiSessionId && message.geminiSessionId !== 'N/A') {
            console.log(`📋 Gemini session ID: ${message.geminiSessionId}`);
          } else {
            console.log(`📋 Using client session ID (Gemini: N/A)`);
          }
          this.currentSession = message.sessionId;
          break;
        case 'context_loaded':
          console.log(`📚 Context loaded: ${message.messagesLoaded} messages`);
          break;
        case 'session_message':
          this.handleLiveResponse(message);
          break;
        case 'generation_complete':
          this.flushBufferedResponse();
          break;
        case 'session_resumption_update':
          // Handle silently to reduce noise
          break;
        case 'ping':
          // Handle silently to reduce noise
          break;
        case 'session_error':
          console.error(`❌ Session error: ${message.error}`);
          break;
        case 'error':
          console.error(`❌ Error: ${message.message || message.error || JSON.stringify(message)}`);
          break;
        case 'audio_saved':
          console.log(`💾 Audio saved: ${message.audioId}`);
          break;
        default:
          console.log('📥 Received:', message.type);
      }
    } catch (error) {
      console.error('❌ Error parsing WebSocket message:', error.message);
    }
  }

  /**
   * Handle Live API response with enhanced formatting
   */
  handleLiveResponse(message) {
    const data = message.data;
    
    if (data.serverContent) {
      const serverContent = data.serverContent;
      
      // Handle text response with buffering
      if (serverContent.modelTurn && serverContent.modelTurn.parts) {
        for (const part of serverContent.modelTurn.parts) {
          if (part.text) {
            // Start buffering if this is the first part
            if (!this.isResponseInProgress) {
              this.isResponseInProgress = true;
              this.currentResponse = '';
              console.log('\n' + chalk.bold.magenta('🤖 AI') + chalk.dim(' › '));
              const responseWidth = 60;
              console.log(chalk.dim('╭─' + '─'.repeat(responseWidth) + '─╮'));
              console.log(chalk.dim('│') + ''.padEnd(responseWidth) + chalk.dim('│'));
            }
            
            // Accumulate the response text
            this.currentResponse += part.text;
          }
        }
      }
      
      // Handle audio transcription
      if (serverContent.outputTranscription) {
        console.log(chalk.blue(`🎧 Audio transcription: `) + chalk.white(serverContent.outputTranscription.text));
      }
      
      // Handle audio data
      if (serverContent.modelTurn && serverContent.modelTurn.parts) {
        for (const part of serverContent.modelTurn.parts) {
          if (part.inlineData && part.inlineData.mimeType.startsWith('audio/')) {
            console.log(chalk.green('🔊 Received audio response'));
            this.saveAudioResponse(part.inlineData.data);
          }
        }
      }
      
      // Handle interruptions
      if (serverContent.interrupted) {
        console.log(chalk.yellow('⏸️ Generation was interrupted'));
        this.flushBufferedResponse();
      }
      
      // Handle generation complete - display the complete buffered response
      if (serverContent.generationComplete) {
        this.flushBufferedResponse();
      }
    }
    
    // Handle tool calls
    if (data.toolCall) {
      console.log(chalk.yellow('🔧 Tool call received: ') + chalk.white(JSON.stringify(data.toolCall, null, 2)));
    }
    
    // Handle empty or invalid responses (removed - too noisy)
  }

  /**
   * Flush the buffered response and display it formatted
   */
  flushBufferedResponse() {
    if (this.isResponseInProgress && this.currentResponse && this.currentResponse.trim()) {
      // Try to render as markdown if it contains markdown syntax
      if (this.currentResponse.includes('*') || this.currentResponse.includes('#') || 
          this.currentResponse.includes('`') || this.currentResponse.includes('**') || 
          this.currentResponse.includes('```') || this.currentResponse.includes('- ')) {
        try {
          const rendered = this.renderMarkdown(this.currentResponse);
          console.log(rendered);
        } catch (error) {
          console.log(chalk.white(this.currentResponse));
        }
      } else {
        console.log(chalk.white(this.currentResponse));
      }
      const responseWidth = 60;
      console.log(chalk.dim('│') + ''.padEnd(responseWidth) + chalk.dim('│'));
      console.log(chalk.dim('╰─' + '─'.repeat(responseWidth) + '─╯'));
      console.log(chalk.green('✅ Response complete\n'));
      
      // Reset buffer
      this.currentResponse = '';
      this.isResponseInProgress = false;
    } else if (this.isResponseInProgress) {
      // Handle case where response was started but no content received
      console.log(chalk.yellow('⚠️ Empty response received'));
      const responseWidth = 60;
      console.log(chalk.dim('│') + ''.padEnd(responseWidth) + chalk.dim('│'));
      console.log(chalk.dim('╰─' + '─'.repeat(responseWidth) + '─╯'));
      console.log(chalk.yellow('⚠️ Response complete (empty)\n'));
      
      // Reset buffer
      this.currentResponse = '';
      this.isResponseInProgress = false;
    }
  }

  /**
   * Parse @ file syntax from user input
   * Extracts file paths marked with @ and returns parsed content with file paths
   */
  parseFileAttachments(input) {
    // Regex to match @path patterns (handles quoted paths and simple paths)
    const filePattern = /@(?:"([^"]+)"|'([^']+)'|([^\s]+))/g;
    const files = [];
    let matches;
    
    // Extract all @file patterns
    while ((matches = filePattern.exec(input)) !== null) {
      // Get the file path (from any of the three capture groups)
      const filePath = matches[1] || matches[2] || matches[3];
      if (filePath && filePath !== '[cancelled]' && !filePath.includes('[cancelled]')) {
        files.push({
          originalMatch: matches[0],
          path: filePath,
          absolutePath: path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath)
        });
      }
    }
    
    // Remove @file patterns from the text (create new regex to avoid lastIndex issues)
    const cleanText = input.replace(/@(?:"([^"]+)"|'([^']+)'|([^\s]+))/g, '').trim();
    
    return {
      text: cleanText,
      files: files
    };
  }

    /**
   * Upload file to backend API
   */
  async uploadFileToBackend(filePath, userId) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const stats = fs.statSync(filePath);
    const mimeType = this.getMimeType(filePath);
    
    console.log(chalk.blue(`📤 Uploading file: `) + chalk.white(path.basename(filePath)) + 
               chalk.dim(` (${(stats.size / 1024 / 1024).toFixed(2)}MB)`));
    console.log(chalk.dim(`   MIME type: ${mimeType}`));

    // Check if file type is supported (common supported types)
    const supportedTypes = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'application/pdf',
      'text/plain', 'text/csv',
      'application/json',
      'video/mp4', 'video/mpeg', 'video/mov',
      'audio/mpeg', 'audio/wav', 'audio/ogg'
    ];

    // For .md files, force them as text/plain
    let actualMimeType = mimeType;
    if (path.extname(filePath).toLowerCase() === '.md') {
      actualMimeType = 'text/plain';
      console.log(chalk.yellow(`📝 Converting .md file to text/plain for compatibility`));
    }

    const formData = new FormData();
    
    // Create a proper file stream with correct options
    const fileStream = fs.createReadStream(filePath);
    formData.append('files', fileStream, {
      filename: path.basename(filePath),
      contentType: actualMimeType
    });
    
    formData.append('userId', userId);
    // Remove storageMethod parameter as it's not allowed by the backend
    
    if (this.currentConversation) {
      formData.append('conversationId', this.currentConversation.conversationId);
    }

    try {
      const response = await fetch(`${this.baseUrl}/files/smart-upload`, {
        method: 'POST',
        body: formData,
        headers: {
          // Let fetch set the Content-Type header with boundary for FormData
          ...formData.getHeaders?.() || {}
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage;
        
        try {
          const errorData = JSON.parse(errorText);
          errorMessage = errorData.error?.message || errorData.message || response.statusText;
        } catch {
          errorMessage = errorText || response.statusText;
        }
        
        // Provide helpful error messages for common issues
        if (errorMessage.includes('not supported')) {
          throw new Error(`File type not supported: ${actualMimeType}. Try converting to a supported format (PDF, JPEG, PNG, TXT, JSON, MP4, MP3).`);
        }
        
        throw new Error(`File upload failed: ${errorMessage}`);
      }

      const data = await response.json();
      
      if (!data.success || !data.files || data.files.length === 0) {
        throw new Error('File upload failed: No file data returned');
      }

      const uploadedFile = data.files[0];
      console.log(chalk.green(`✅ File uploaded successfully `) + 
                 chalk.yellow(`(${data.storageMethod})`) + 
                 chalk.white(`: ${uploadedFile.originalName}`));
      
      // For Google File API uploads, extract the URI from the response
      let fileUri = null;
      if (data.storageMethod === 'google-file-api') {
        // Check for URI in the response (new format)
        if (uploadedFile.uri) {
          fileUri = uploadedFile.uri;
        }
        // Fallback to old format
        else if (uploadedFile.url && uploadedFile.url.startsWith('gs://')) {
          fileUri = uploadedFile.url;
        } 
        // Last resort: fetch file metadata
        else if (uploadedFile.fileId) {
          // If we don't have the URI directly, try to fetch it from the backend
          try {
            const fileResponse = await fetch(`${this.baseUrl}/files/${uploadedFile.fileId}?userId=${this.currentUser.id || this.currentUser._id}`);
            if (fileResponse.ok) {
              const fileData = await fileResponse.json();
              if (fileData.success && fileData.file.storage && fileData.file.storage.url && fileData.file.storage.url.startsWith('gs://')) {
                fileUri = fileData.file.storage.url;
              } else if (fileData.success && fileData.file.aiProviderFile && fileData.file.aiProviderFile.fileUri) {
                fileUri = fileData.file.aiProviderFile.fileUri;
              }
            }
          } catch (fetchError) {
            console.warn('Could not fetch file metadata for URI:', fetchError.message);
          }
        }
      }
      
      // Return file info in format needed for Live API
      return {
        fileId: uploadedFile.fileId,
        originalName: uploadedFile.originalName,
        mimeType: uploadedFile.mimeType,
        size: uploadedFile.size,
        storageMethod: data.storageMethod,
        uri: fileUri
      };
      
    } catch (fetchError) {
      if (fetchError.message.includes('File upload failed')) {
        throw fetchError;
      }
      throw new Error(`Network error during file upload: ${fetchError.message}`);
    }
  }

  /**
   * Get MIME type based on file extension
   */
  getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      // Images
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.bmp': 'image/bmp',
      '.svg': 'image/svg+xml',
      
      // Documents
      '.pdf': 'application/pdf',
      '.txt': 'text/plain',
      '.md': 'text/markdown',
      '.csv': 'text/csv',
      '.json': 'application/json',
      '.xml': 'application/xml',
      '.html': 'text/html',
      '.htm': 'text/html',
      
      // Code files
      '.js': 'text/javascript',
      '.ts': 'text/typescript',
      '.py': 'text/x-python',
      '.java': 'text/x-java-source',
      '.cpp': 'text/x-c++src',
      '.c': 'text/x-csrc',
      '.h': 'text/x-chdr',
      '.css': 'text/css',
      
      // Audio
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.ogg': 'audio/ogg',
      '.flac': 'audio/flac',
      '.aac': 'audio/aac',
      
      // Video
      '.mp4': 'video/mp4',
      '.avi': 'video/x-msvideo',
      '.mov': 'video/quicktime',
      '.webm': 'video/webm',
      '.mkv': 'video/x-matroska',
      '.flv': 'video/x-flv'
    };
    return mimeTypes[ext] || 'application/octet-stream';
  }

  /**
   * Show supported file types
   */
  showSupportedFileTypes() {
    console.log(chalk.bold.cyan('\n📋 Supported File Types for Live API'));
    console.log(chalk.cyan('='.repeat(45)));
    
    console.log(chalk.bold.green('\n🖼️  Images (best compatibility):'));
    console.log(chalk.white('   • JPEG (.jpg, .jpeg)'));
    console.log(chalk.white('   • PNG (.png)'));
    console.log(chalk.white('   • GIF (.gif)'));
    console.log(chalk.white('   • WebP (.webp)'));
    
    console.log(chalk.bold.blue('\n📄  Documents:'));
    console.log(chalk.white('   • PDF (.pdf) ') + chalk.green('[✨ Enhanced Support]'));
    console.log(chalk.white('   • Plain text (.txt)'));
    console.log(chalk.white('   • CSV (.csv)'));
    console.log(chalk.white('   • JSON (.json)'));
    
    console.log(chalk.bold.yellow('\n💻  Code files (converted to text):'));
    console.log(chalk.white('   • Markdown (.md)'));
    console.log(chalk.white('   • JavaScript (.js, .ts)'));
    console.log(chalk.white('   • Python (.py)'));
    console.log(chalk.white('   • Java (.java)'));
    console.log(chalk.white('   • C/C++ (.c, .cpp, .h)'));
    
    console.log(chalk.bold.magenta('\n🎵  Media (when supported):'));
    console.log(chalk.white('   • Audio: MP3 (.mp3), WAV (.wav), OGG (.ogg)'));
    console.log(chalk.white('   • Video: MP4 (.mp4), WebM (.webm), MOV (.mov)'));
    
    console.log(chalk.bold.red('\n⚠️  Notes:'));
    console.log(chalk.dim('   • Large files (>20MB) and PDFs automatically use Google File API'));
    console.log(chalk.dim('   • Small files (except PDFs) are sent as inline data'));
    console.log(chalk.dim('   • Markdown files are converted to text/plain for compatibility'));
    console.log(chalk.dim('   • PDFs require special processing for Live API compatibility'));
    console.log('');
  }

  /**
   * Send text message with optional file attachments to Live API
   */
  async sendTextMessage(text) {
    if (!this.currentSession) {
      console.error('❌ No active session');
      return;
    }
    
    try {
      // Parse file attachments from @ syntax
      const parsed = this.parseFileAttachments(text);
      
      if (parsed.files.length > 0) {
        console.log(chalk.yellow(`📝 Parsed input - Text: `) + chalk.white(`"${parsed.text}"`) + 
                   chalk.yellow(`, Files: `) + chalk.cyan(parsed.files.length));
      }

      // Build content parts
      const parts = [];
      
      // Handle file uploads if any @ syntax found
      if (parsed.files.length > 0) {
        if (!this.currentUser) {
          console.error('❌ User required for file uploads');
      return;
    }
    
        console.log(chalk.blue(`📂 Processing `) + chalk.cyan(parsed.files.length) + 
                   chalk.blue(` file attachment(s)...`));
        
        // Check if we need to force all files to use Google File API
        let forceGoogleFileApi = false;
        for (const fileInfo of parsed.files) {
          if (fileInfo.path === '[cancelled]' || fileInfo.path.includes('[cancelled]')) continue;
          
          const stats = fs.statSync(fileInfo.absolutePath);
          const fileSizeMB = stats.size / (1024 * 1024);
          const fileExtension = path.extname(fileInfo.absolutePath).toLowerCase();
          
          // If any file is large or PDF, force all files to use Google File API
          if (fileSizeMB > 20 || fileExtension === '.pdf') {
            forceGoogleFileApi = true;
            break;
          }
        }
        
        if (forceGoogleFileApi && parsed.files.length > 1) {
          console.log(chalk.blue(`🔄 Multiple files detected with mixed sizes/types - using Google File API for all`));
        }
        
        for (const fileInfo of parsed.files) {
          try {
            // Skip cancelled file placeholders
            if (fileInfo.path === '[cancelled]' || fileInfo.path.includes('[cancelled]')) {
              console.log(chalk.dim(`⏭️ Skipping cancelled file: `) + chalk.dim(fileInfo.path));
              continue;
            }
            
            console.log(chalk.yellow(`📎 Processing file: `) + chalk.white(fileInfo.path));
            
            // Check file size and type to determine processing method
            const stats = fs.statSync(fileInfo.absolutePath);
            const fileSizeMB = stats.size / (1024 * 1024);
            const fileExtension = path.extname(fileInfo.absolutePath).toLowerCase();
            
            // Use Google File API if forced or for large files/PDFs
            if (forceGoogleFileApi || fileSizeMB > 20 || fileExtension === '.pdf') {
              // For large files, upload to backend and use Google File API
              const uploadedFile = await this.uploadFileToBackend(
                fileInfo.absolutePath, 
                this.currentUser.id || this.currentUser._id
              );

              // Check for URI in both direct response and files array
              const fileUri = uploadedFile.uri || (uploadedFile.files && uploadedFile.files[0]?.uri);
              const fileMimeType = uploadedFile.mimeType || (uploadedFile.files && uploadedFile.files[0]?.mimeType);
              const fileName = uploadedFile.originalName || (uploadedFile.files && uploadedFile.files[0]?.originalName);
              const storageMethod = uploadedFile.storageMethod || 'google-file-api';

              if (fileUri && (fileUri.startsWith('gs://') || fileUri.startsWith('https://generativelanguage.googleapis.com/'))) {
                parts.push({
                  fileData: {
                    mimeType: fileMimeType,
                    fileUri: fileUri
                  }
                });
                let fileType = 'file';
                if (fileExtension === '.pdf') {
                  fileType = 'PDF file';
                } else if (fileSizeMB > 20) {
                  fileType = 'large file';
                } else if (forceGoogleFileApi) {
                  fileType = 'file (forced Google File API)';
                }
                console.log(chalk.green(`✅ Added ${fileType} to Live API message: `) + 
                           chalk.white(fileName) + 
                           chalk.dim(` (${storageMethod})`));
              } else {
                let warningFileType = 'File';
                if (fileExtension === '.pdf') {
                  warningFileType = 'PDF file';
                } else if (fileSizeMB > 20) {
                  warningFileType = 'Large file';
                } else if (forceGoogleFileApi) {
                  warningFileType = 'File (forced Google File API)';
                }
                console.warn(chalk.yellow(`⚠️ ${warningFileType} `) + chalk.white(fileName) + 
                            chalk.yellow(` uploaded but missing Google File API URI`));
                console.log(chalk.dim(`Debug: uploadedFile structure: ${JSON.stringify(uploadedFile, null, 2)}`));
              }
            } else {
              // For small files when not forced to use Google File API, send inline data directly to Live API
              const fileContent = fs.readFileSync(fileInfo.absolutePath);
              const mimeType = this.getMimeType(fileInfo.absolutePath);
              
              // Force .md files to text/plain for better compatibility
              let actualMimeType = mimeType;
              if (path.extname(fileInfo.absolutePath).toLowerCase() === '.md') {
                actualMimeType = 'text/plain';
              }
              
              parts.push({
                inlineData: {
                  mimeType: actualMimeType,
                  data: fileContent.toString('base64')
                }
              });
              
              console.log(chalk.green(`✅ Added inline file to Live API message: `) + 
                         chalk.white(path.basename(fileInfo.path)) + 
                         chalk.dim(` (${fileSizeMB.toFixed(2)}MB, inline)`));
              
              // Also upload to backend for record keeping
              try {
                await this.uploadFileToBackend(
                  fileInfo.absolutePath, 
                  this.currentUser.id || this.currentUser._id
                );
              } catch (backendError) {
                console.warn(chalk.yellow(`⚠️ Backend upload failed but file sent to Live API: ${backendError.message}`));
              }
            }
          } catch (fileError) {
            console.error(`❌ Failed to process file ${fileInfo.path}:`, fileError.message);
            // Continue with other files and text message
          }
        }
      }

      // Add text part - handle all text scenarios
      const finalText = parsed.text && parsed.text.trim() ? parsed.text.trim() : 
                       (text && text.trim() ? text.trim() : '');
      
      if (finalText) {
        parts.push({ text: finalText });
      }

      // If no valid parts (no text and no files), don't send
      if (parts.length === 0) {
        console.error(chalk.red('❌ No valid content to send (text or files)'));
        return;
      }

      // ALWAYS use turns format - this fixes backend parsing issues
      const message = {
      type: 'send_message',
      sessionId: this.currentSession,
      data: {
          turns: [{ role: 'user', parts }],
        turnComplete: true
      }
    };
    
      const summary = [];
      if (finalText) summary.push(chalk.blue(`text: `) + chalk.white(`"${finalText.substring(0, 50)}${finalText.length > 50 ? '...' : ''}"`));
      const fileCount = parts.filter(p => p.fileData || p.inlineData).length;
      if (fileCount > 0) {
        summary.push(chalk.green(`files: `) + chalk.cyan(fileCount));
      }
      
      console.log(chalk.magenta(`📤 Sending message (turns format) with `) + summary.join(chalk.white(', ')));
      this.ws.send(JSON.stringify(message));

    } catch (error) {
      console.error('❌ Error processing message:', error.message);
      
      // Fallback: send just the original text in turns format
      if (text && text.trim()) {
        console.log(chalk.yellow('🔄 Falling back to text-only message...'));
        const fallbackMessage = {
          type: 'send_message',
          sessionId: this.currentSession,
          data: {
            turns: [{ role: 'user', parts: [{ text: text.trim() }] }],
            turnComplete: true
          }
        };
        
        console.log(chalk.magenta(`📤 Sending fallback (turns format): `) + chalk.white(`"${text.trim()}"`));
        this.ws.send(JSON.stringify(fallbackMessage));
      }
    }
  }



  /**
   * Save audio response to file
   */
  saveAudioResponse(base64Audio) {
    try {
      const audioDir = path.join(process.cwd(), 'uploads', 'audio');
      if (!fs.existsSync(audioDir)) {
        fs.mkdirSync(audioDir, { recursive: true });
      }
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `live_response_${timestamp}.wav`;
      const filepath = path.join(audioDir, filename);
      
      const audioBuffer = Buffer.from(base64Audio, 'base64');
      fs.writeFileSync(filepath, audioBuffer);
      
      console.log(`💾 Audio saved to: ${filepath}`);
      console.log(`🎵 You can play it with: npx play-sound ${filepath}`);
    } catch (error) {
      console.error('❌ Error saving audio:', error.message);
    }
  }

  /**
   * Wait for session creation
   */
  async waitForSessionCreation() {
    return new Promise((resolve) => {
      const checkForSession = () => {
        const sessionMessage = this.responseQueue.find(msg => msg.type === 'session_created');
        if (sessionMessage) {
          resolve(sessionMessage);
        } else {
          setTimeout(checkForSession, 100);
        }
      };
      checkForSession();
    });
  }

  /**
   * Wait for response from Live API
   */
  async waitForResponse() {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        console.log('⏰ Response timeout');
        resolve();
      }, 30000);
      
      const checkForResponse = () => {
        const responseMessage = this.responseQueue.find(msg => 
          msg.type === 'generation_complete' ||
          (msg.type === 'session_message' && msg.data?.serverContent?.generationComplete)
        );
        
        if (responseMessage) {
          clearTimeout(timeout);
          resolve(responseMessage);
        } else {
          setTimeout(checkForResponse, 100);
        }
      };
      
      checkForResponse();
    });
  }

  /**
   * Show file attachment help and examples
   */
  showFileAttachmentHelp() {
    console.log('\n📁 File Attachment Help');
    console.log('=======================');
    console.log('Use @ syntax to attach files to your messages:');
    console.log('');
    console.log('📋 Examples:');
    console.log('• "What is in this @image.jpg ?"');
    console.log('• "Compare @ @ and explain the differences" (interactive selection)');
    console.log('• "Analyze @/full/path/to/file.txt"');
    console.log('• "Read @"./file with spaces.pdf" please"');
    console.log('• "Compare @doc1.pdf @ and summarize" (mix existing + new)');
    console.log('');
    console.log('✅ Supported file types:');
    console.log('• Images: .jpg, .jpeg, .png, .gif, .webp');
    console.log('• Documents: .pdf, .txt, .md, .csv, .json');
    console.log('• Audio: .mp3, .wav');
    console.log('• Video: .mp4, .avi, .mov, .webm');
    console.log('');
    console.log('🔄 File Processing:');
    console.log('• Files are automatically uploaded to the backend');
    console.log('• Large files (>20MB) use Google File API for optimal AI processing');
    console.log('• Small files use local storage for faster access');
    console.log('• Files are linked to your current conversation');
    console.log('');
    console.log('💡 Tips:');
    console.log('• Use multiple @ symbols for sequential file selection');
    console.log('• Type @ anywhere to trigger interactive file picker');
    console.log('• Mix @ symbols with existing file references');
    console.log('• Use quotes for paths with spaces: @"path with spaces.pdf"');
    console.log('• PDFs now work perfectly with Google File API integration');
    console.log('');
  }

  /**
   * Show current configuration
   */
  showCurrentConfig() {
    console.log('\n📋 Current Configuration:');
    console.log('=========================');
    
    if (this.currentUser) {
      console.log(`👤 User: ${this.currentUser.fullName || this.currentUser.email || this.currentUser.id || this.currentUser._id}`);
      console.log(`📧 Email: ${this.currentUser.email || 'N/A'}`);
      console.log(`🏷️ Role: ${this.currentUser.role || 'user'}`);
    }
    
    if (this.currentConversation) {
      console.log(`💬 Conversation: ${this.currentConversation.title || this.currentConversation.conversationId}`);
      console.log(`🆔 Conversation ID: ${this.currentConversation.conversationId}`);
      console.log(`📊 Messages: ${this.currentConversation.stats?.totalMessages || 0}`);
    }
    
    if (this.config) {
      console.log(`🤖 Model: ${this.config.model}`);
      console.log(`📡 Response Mode: ${this.config.responseModality}`);
      console.log(`🎥 Media Resolution: ${this.config.mediaResolution}`);
      console.log(`🔗 Load Context: ${this.config.loadConversationContext ? 'Yes' : 'No'}`);
      
      if (this.config.voiceConfig) {
        console.log(`🎤 Voice: ${this.config.voiceConfig.voiceName} (${this.config.voiceConfig.languageCode})`);
      }
    } else {
      console.log('⚠️ No Live API configuration set');
    }
    
    if (this.currentSession) {
      console.log(`🔗 Session ID: ${this.currentSession}`);
      console.log(`📡 Connection Status: ${this.isConnected ? 'Connected' : 'Disconnected'}`);
    }
    
    console.log('');
  }

  /**
   * Disconnect from WebSocket
   */
  disconnect() {
    if (this.ws && this.isConnected) {
      console.log('🔌 Disconnecting from Live API...');
      this.ws.close();
      this.isConnected = false;
      this.currentSession = null;
    }
  }

  /**
   * Clean up resources
   */
  cleanup() {
    this.disconnect();
    if (this.audioProcess) {
      this.audioProcess.kill();
    }
    this.rl.close();
  }

  /**
   * Utility method for asking questions
   */
  question(prompt) {
    return new Promise((resolve) => {
      this.rl.question(prompt, resolve);
    });
  }
}

// Handle process termination
process.on('SIGINT', () => {
  console.log('\n\n👋 Goodbye!');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n\n👋 Goodbye!');
  process.exit(0);
});

// Start the Live API tester
const tester = new LiveAPITester();
tester.start().catch(console.error);