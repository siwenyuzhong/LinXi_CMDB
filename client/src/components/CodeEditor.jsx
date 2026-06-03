import React, {useRef, useCallback} from 'react';

const LINE_STYLE = {
    height: '24px',
    minHeight: '24px',
    whiteSpace: 'pre',
};

function tokenizePython(line) {
    const tokens = [];
    const rules = [
        {re: /^(#.*)/, cls: 'hl-comment'},
        {re: /^(\bdef\s+\w+)/, cls: 'hl-func'},
        {re: /^(\bclass\s+\w+)/, cls: 'hl-class'},
        {
            re: /^(\b(?:and|as|assert|async|await|break|continue|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|raise|return|try|while|with|yield|True|False|None)\b)/,
            cls: 'hl-keyword'
        },
        {re: /^((["'])(?:(?!\2|\\).|\\.)*\2)/, cls: 'hl-string'},
        {re: /^(\b\d+\.?\d*(?:[eE][+-]?\d+)?\b)/, cls: 'hl-number'},
        {re: /^(@\w+)/, cls: 'hl-decorator'},
    ];
    let remaining = line;
    while (remaining.length > 0) {
        let matched = false;
        for (const rule of rules) {
            const m = remaining.match(rule.re);
            if (m) {
                tokens.push({text: m[1], cls: rule.cls});
                remaining = remaining.slice(m[0].length);
                matched = true;
                break;
            }
        }
        if (!matched) {
            tokens.push({text: remaining[0], cls: null});
            remaining = remaining.slice(1);
        }
    }
    return tokens;
}

function tokenizeShell(line) {
    const tokens = [];
    const rules = [
        {re: /^(#.*)/, cls: 'hl-comment'},
        {re: /^(\$\{?\w+\}?)/, cls: 'hl-variable'},
        {re: /^((["'])(?:(?!\2|\\).|\\.)*\2)/, cls: 'hl-string'},
        {
            re: /^(\b(?:if|then|else|elif|fi|for|while|do|done|case|esac|in|function|return|exit|export|source|local|echo|printf|read|cd|mkdir|rm|cp|mv|cat|grep|sed|awk|chmod|chown|curl|wget|exec|eval|trap|select|until|continue|break)\b)/,
            cls: 'hl-keyword'
        },
        {re: /^(\b\d+\b)/, cls: 'hl-number'},
    ];
    let remaining = line;
    while (remaining.length > 0) {
        let matched = false;
        for (const rule of rules) {
            const m = remaining.match(rule.re);
            if (m) {
                tokens.push({text: m[1], cls: rule.cls});
                remaining = remaining.slice(m[0].length);
                matched = true;
                break;
            }
        }
        if (!matched) {
            tokens.push({text: remaining[0], cls: null});
            remaining = remaining.slice(1);
        }
    }
    return tokens;
}

function tokenizeLine(line, type) {
    if (type === 'python') return tokenizePython(line);
    if (type === 'shell') return tokenizeShell(line);
    return [{text: line, cls: null}];
}

const TEXTAREA_STYLE = {
    display: 'block',
    padding: '12px 14px',
    fontFamily: "'SF Mono','Fira Code','Cascadia Code','JetBrains Mono',Consolas,monospace",
    fontSize: '13px',
    lineHeight: '24px',
    tabSize: 4,
    whiteSpace: 'pre',
    overflow: 'auto',
    resize: 'vertical',
    border: 'none',
    outline: 'none',
    background: 'transparent',
    color: 'transparent',
    caretColor: '#e6edf3',
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1,
};

const PRE_STYLE = {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    margin: 0,
    padding: '12px 14px',
    fontFamily: "'SF Mono','Fira Code','Cascadia Code','JetBrains Mono',Consolas,monospace",
    fontSize: '13px',
    lineHeight: '24px',
    tabSize: 4,
    whiteSpace: 'pre',
    overflow: 'hidden',
    color: '#e6edf3',
    background: 'transparent',
    pointerEvents: 'none',
    border: 'none',
};

export default function CodeEditor({value, onChange, type, placeholder, minHeight = '260px'}) {
    const textareaRef = useRef(null);
    const preRef = useRef(null);

    const syncScroll = useCallback(() => {
        if (textareaRef.current && preRef.current) {
            preRef.current.scrollTop = textareaRef.current.scrollTop;
            preRef.current.scrollLeft = textareaRef.current.scrollLeft;
        }
    }, []);

    const lines = (value || '').split('\n');

    const containerStyle = {
        position: 'relative',
        flex: 1,
        minHeight,
        background: '#0d1117',
        borderRadius: '8px',
        overflow: 'hidden',
    };

    return (
        <div style={containerStyle}>
      <pre ref={preRef} style={PRE_STYLE} aria-hidden="true">
        {lines.map((line, i) => {
            const tokens = tokenizeLine(line, type);
            return (
                <div key={i} style={LINE_STYLE}>
                    {tokens.map((tok, j) => {
                        if (tok.cls === 'hl-comment') return <span key={j} style={{
                            color: '#8b949e',
                            fontStyle: 'italic'
                        }}>{tok.text}</span>;
                        if (tok.cls === 'hl-keyword') return <span key={j} style={{color: '#ff7b72'}}>{tok.text}</span>;
                        if (tok.cls === 'hl-string') return <span key={j} style={{color: '#a5d6ff'}}>{tok.text}</span>;
                        if (tok.cls === 'hl-number') return <span key={j} style={{color: '#79c0ff'}}>{tok.text}</span>;
                        if (tok.cls === 'hl-func') return <span key={j} style={{color: '#d2a8ff'}}>{tok.text}</span>;
                        if (tok.cls === 'hl-class') return <span key={j} style={{color: '#ffa657'}}>{tok.text}</span>;
                        if (tok.cls === 'hl-decorator') return <span key={j} style={{color: '#d2a8ff'}}>{tok.text}</span>;
                        if (tok.cls === 'hl-variable') return <span key={j} style={{color: '#ffa657'}}>{tok.text}</span>;
                        return <span key={j}>{tok.text}</span>;
                    })}
                </div>
            );
        })}
      </pre>
            <textarea
                ref={textareaRef}
                style={TEXTAREA_STYLE}
                value={value}
                onChange={onChange}
                onScroll={syncScroll}
                placeholder={placeholder}
                spellCheck={false}
                wrap="off"
            />
        </div>
    );
}
