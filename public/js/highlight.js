/*!
 * Outwiles LocalPaste — lightweight syntax highlighter.
 * Regex-based tokenizer covering the languages LocalPaste supports.
 * Deliberately not a full parser: it recognises comments, strings,
 * numbers, and keywords well enough to make pastes readable, without
 * pulling in an external highlighting library or making network calls.
 */
(function (global) {
  'use strict';

  var KEYWORDS = {
    javascript: 'break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof new return super switch this throw try typeof var void while with yield let async await static get set of null true false undefined',
    typescript: 'break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof new return super switch this throw try typeof var void while with yield let async await static get set of null true false undefined interface type implements private public protected readonly enum namespace declare as',
    python: 'False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield self',
    java: 'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch this throw throws transient try void volatile while true false null',
    c: 'auto break case char const continue default do double else enum extern float for goto if int long register return short signed sizeof static struct switch typedef union unsigned void volatile while',
    cpp: 'alignas alignof and and_eq asm auto bitand bitor bool break case catch char class compl const constexpr const_cast continue decltype default delete do double dynamic_cast else enum explicit export extern false float for friend goto if inline int long mutable namespace new noexcept not not_eq nullptr operator or or_eq private protected public register reinterpret_cast return short signed sizeof static static_assert static_cast struct switch template this thread_local throw true try typedef typeid typename union unsigned using virtual void volatile wchar_t while xor xor_eq',
    csharp: 'abstract as base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new null object operator out override params private protected public readonly ref return sbyte sealed short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using virtual void volatile while var async await',
    go: 'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var true false nil iota',
    rust: 'as break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while async await',
    php: 'abstract and array as break callable case catch class clone const continue declare default do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile extends final finally fn for foreach function global goto if implements include include_once instanceof insteadof interface isset list namespace new or print private protected public require require_once return static switch throw trait try unset use var while xor yield true false null',
    ruby: 'BEGIN END alias and begin break case class def defined? do else elsif end ensure false for if in module next nil not or redo rescue retry return self super then true undef unless until when while yield',
    swift: 'associatedtype class deinit enum extension fallthrough fileprivate func import init inout internal let open operator private protocol public rethrows static struct subscript typealias var break case continue default defer do else fallthrough for guard if in repeat return switch where while as Any catch false is nil super self throw throws true try',
    kotlin: 'as break class continue do else false for fun if in interface is null object package return super this throw true try typealias val var when while by companion const init',
    sql: 'SELECT FROM WHERE JOIN INNER LEFT RIGHT OUTER ON GROUP BY ORDER HAVING INSERT INTO VALUES UPDATE SET DELETE CREATE TABLE ALTER DROP INDEX VIEW AND OR NOT NULL IS IN LIKE BETWEEN LIMIT OFFSET AS DISTINCT UNION ALL EXISTS CASE WHEN THEN ELSE END PRIMARY KEY FOREIGN REFERENCES DEFAULT',
    shell: 'if then else elif fi for while do done case esac function return exit export local readonly declare in break continue',
    yaml: 'true false null yes no',
    html: '',
    css: ''
  };
  KEYWORDS.jsx = KEYWORDS.javascript;
  KEYWORDS.tsx = KEYWORDS.typescript;

  var LINE_COMMENT = {
    javascript: '//', typescript: '//', java: '//', c: '//', cpp: '//', csharp: '//',
    go: '//', rust: '//', swift: '//', kotlin: '//', php: '//',
    python: '#', ruby: '#', shell: '#', yaml: '#', sql: '--'
  };

  var BLOCK_COMMENT = {
    javascript: ['/*', '*/'], typescript: ['/*', '*/'], java: ['/*', '*/'],
    c: ['/*', '*/'], cpp: ['/*', '*/'], csharp: ['/*', '*/'], go: ['/*', '*/'],
    rust: ['/*', '*/'], swift: ['/*', '*/'], kotlin: ['/*', '*/'], php: ['/*', '*/'],
    css: ['/*', '*/'], sql: ['/*', '*/'], html: ['<!--', '-->']
  };

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function highlightLine(line, lang) {
    if (lang === 'plaintext' || !lang) return escapeHtml(line);

    var keywordSet = null;
    if (KEYWORDS[lang]) {
      keywordSet = new Set(KEYWORDS[lang].split(' ').filter(Boolean));
    }
    var lineComment = LINE_COMMENT[lang];

    var out = '';
    var i = 0;
    var n = line.length;

    // Check for a full-line/partial line comment start first.
    var commentIdx = -1;
    if (lineComment) {
      commentIdx = line.indexOf(lineComment);
    }

    while (i < n) {
      if (commentIdx === i) {
        out += '<span class="tok-comment">' + escapeHtml(line.slice(i)) + '</span>';
        break;
      }

      var ch = line[i];

      // Strings
      if (ch === '"' || ch === "'" || (ch === '`' && (lang === 'javascript' || lang === 'typescript'))) {
        var quote = ch;
        var j = i + 1;
        while (j < n && line[j] !== quote) {
          if (line[j] === '\\') j++;
          j++;
        }
        j = Math.min(j + 1, n);
        out += '<span class="tok-string">' + escapeHtml(line.slice(i, j)) + '</span>';
        i = j;
        continue;
      }

      // Numbers
      if (/[0-9]/.test(ch) && (i === 0 || !/[A-Za-z0-9_]/.test(line[i - 1]))) {
        var k = i;
        while (k < n && /[0-9a-fA-Fx.]/.test(line[k])) k++;
        out += '<span class="tok-number">' + escapeHtml(line.slice(i, k)) + '</span>';
        i = k;
        continue;
      }

      // Identifiers / keywords
      if (/[A-Za-z_]/.test(ch)) {
        var m = i;
        while (m < n && /[A-Za-z0-9_]/.test(line[m])) m++;
        var word = line.slice(i, m);
        if (keywordSet && keywordSet.has(word)) {
          out += '<span class="tok-keyword">' + escapeHtml(word) + '</span>';
        } else if (line[m] === '(') {
          out += '<span class="tok-function">' + escapeHtml(word) + '</span>';
        } else {
          out += escapeHtml(word);
        }
        i = m;
        continue;
      }

      out += escapeHtml(ch);
      i++;
    }

    return out;
  }

  function highlight(code, lang) {
    var lines = code.split('\n');
    var inBlockComment = false;
    var blockPair = BLOCK_COMMENT[lang];

    return lines.map(function (line) {
      if (blockPair) {
        if (inBlockComment) {
          var endIdx = line.indexOf(blockPair[1]);
          if (endIdx === -1) {
            return '<span class="tok-comment">' + escapeHtml(line) + '</span>';
          }
          inBlockComment = false;
          var rest = highlightLine(line.slice(endIdx + blockPair[1].length), lang);
          return '<span class="tok-comment">' + escapeHtml(line.slice(0, endIdx + blockPair[1].length)) + '</span>' + rest;
        }
        var startIdx = line.indexOf(blockPair[0]);
        if (startIdx !== -1 && line.indexOf(blockPair[1], startIdx + 2) === -1) {
          inBlockComment = true;
          var before = highlightLine(line.slice(0, startIdx), lang);
          return before + '<span class="tok-comment">' + escapeHtml(line.slice(startIdx)) + '</span>';
        }
      }
      return highlightLine(line, lang);
    });
  }

  global.OutwilesHighlight = { highlight: highlight, escapeHtml: escapeHtml };
})(typeof window !== 'undefined' ? window : globalThis);
