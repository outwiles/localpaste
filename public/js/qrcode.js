/*!
 * Minimal, dependency-free QR Code encoder.
 * Implements byte-mode encoding with error correction level M,
 * following the general structure of the ISO/IEC 18004 QR standard.
 * Runs entirely offline in the browser — no network requests.
 *
 * Exposes: window.OutwilesQR.generate(text) -> { modules: boolean[][], size: number }
 */
(function (global) {
  'use strict';

  var PAD0 = 0xec, PAD1 = 0x11;

  // Error correction level M capacity table (byte mode) for versions 1-20,
  // and their per-version block structure needed for Reed-Solomon coding.
  // [totalDataCodewords, ecCodewordsPerBlock, blocksGroup1, dataPerBlockGroup1, blocksGroup2, dataPerBlockGroup2]
  var RS_BLOCK_TABLE = {
    1: [16, 10, 1, 16, 0, 0],
    2: [28, 16, 1, 28, 0, 0],
    3: [44, 26, 1, 44, 0, 0],
    4: [64, 18, 2, 32, 0, 0],
    5: [86, 24, 2, 43, 0, 0],
    6: [108, 16, 4, 27, 0, 0],
    7: [124, 18, 4, 31, 0, 0],
    8: [154, 22, 2, 38, 2, 39],
    9: [182, 22, 3, 36, 2, 37],
    10: [216, 26, 4, 43, 1, 44]
  };

  var CAPACITY_VERSION_FOR_LENGTH = null; // computed lazily below

  function getCapacityBytes(version) {
    var t = RS_BLOCK_TABLE[version];
    return t[0];
  }

  // --- Galois Field math for Reed-Solomon error correction ---
  var EXP_TABLE = new Array(256);
  var LOG_TABLE = new Array(256);
  (function initGF() {
    for (var i = 0; i < 8; i++) EXP_TABLE[i] = 1 << i;
    for (var j = 8; j < 256; j++) {
      EXP_TABLE[j] = EXP_TABLE[j - 4] ^ EXP_TABLE[j - 5] ^ EXP_TABLE[j - 6] ^ EXP_TABLE[j - 8];
    }
    for (var k = 0; k < 255; k++) LOG_TABLE[EXP_TABLE[k]] = k;
  })();

  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return EXP_TABLE[(LOG_TABLE[a] + LOG_TABLE[b]) % 255];
  }

  function Polynomial(nums) {
    var offset = 0;
    while (offset < nums.length - 1 && nums[offset] === 0) offset++;
    this.num = nums.slice(offset);
  }
  Polynomial.prototype.get = function (i) { return this.num[i]; };
  Polynomial.prototype.getLength = function () { return this.num.length; };
  Polynomial.prototype.multiply = function (e) {
    var num = new Array(this.getLength() + e.getLength() - 1).fill(0);
    for (var i = 0; i < this.getLength(); i++) {
      for (var j = 0; j < e.getLength(); j++) {
        num[i + j] ^= gfMul(this.get(i), e.get(j));
      }
    }
    return new Polynomial(num);
  };
  Polynomial.prototype.mod = function (e) {
    if (this.getLength() - e.getLength() < 0) return this;
    var ratio = LOG_TABLE[this.get(0)] - LOG_TABLE[e.get(0)];
    var num = this.num.slice();
    for (var i = 0; i < e.getLength(); i++) {
      num[i] ^= gfMul(e.get(i), EXP_TABLE[(ratio + 255) % 255]);
    }
    return new Polynomial(num).mod(e);
  };

  function errorCorrectPolynomial(ecLength) {
    var e = new Polynomial([1]);
    for (var i = 0; i < ecLength; i++) {
      e = e.multiply(new Polynomial([1, EXP_TABLE[i]]));
    }
    return e;
  }

  // --- Data encoding (byte mode) ---
  function toUtf8Bytes(str) {
    return Array.from(new TextEncoder().encode(str));
  }

  function chooseVersion(byteLength) {
    for (var v = 1; v <= 10; v++) {
      // 8-bit byte mode header: 4 bits mode + 8 bits length (v1-9) — approximate overhead.
      var overheadBits = 4 + 8;
      var capacityBits = getCapacityBytes(v) * 8;
      if (byteLength * 8 + overheadBits + 4 <= capacityBits) return v;
    }
    return 10; // fall back to the largest supported version; caller should keep URLs short
  }

  function createDataBits(bytes, version) {
    var bits = [];
    function push(value, length) {
      for (var i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
    }
    push(0b0100, 4); // byte mode indicator
    var lenBits = version <= 9 ? 8 : 16;
    push(bytes.length, lenBits);
    bytes.forEach(function (b) { push(b, 8); });

    var totalDataBits = getCapacityBytes(version) * 8;
    // Terminator
    var termLen = Math.min(4, totalDataBits - bits.length);
    for (var t = 0; t < termLen; t++) bits.push(0);
    while (bits.length % 8 !== 0) bits.push(0);

    var dataBytes = [];
    for (var i = 0; i < bits.length; i += 8) {
      var byte = 0;
      for (var j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
      dataBytes.push(byte);
    }

    var totalDataBytes = getCapacityBytes(version);
    var padToggle = true;
    while (dataBytes.length < totalDataBytes) {
      dataBytes.push(padToggle ? PAD0 : PAD1);
      padToggle = !padToggle;
    }
    return dataBytes;
  }

  function buildCodewords(dataBytes, version) {
    var t = RS_BLOCK_TABLE[version];
    var ecCount = t[1];
    var blocks = [];
    var offset = 0;
    for (var g = 0; g < 2; g++) {
      var numBlocks = g === 0 ? t[2] : t[4];
      var blockSize = g === 0 ? t[3] : t[5];
      for (var b = 0; b < numBlocks; b++) {
        blocks.push(dataBytes.slice(offset, offset + blockSize));
        offset += blockSize;
      }
    }

    var rsPoly = errorCorrectPolynomial(ecCount);
    var ecBlocks = blocks.map(function (block) {
      var raw = block.concat(new Array(ecCount).fill(0));
      var mod = new Polynomial(raw).mod(rsPoly);
      var ec = new Array(ecCount).fill(0);
      for (var i = 0; i < ec.length; i++) {
        var idx = i + mod.getLength() - ec.length;
        ec[i] = idx >= 0 ? mod.get(idx) : 0;
      }
      return ec;
    });

    var maxDataLen = Math.max.apply(null, blocks.map(function (b) { return b.length; }));
    var interleavedData = [];
    for (var i = 0; i < maxDataLen; i++) {
      blocks.forEach(function (block) {
        if (i < block.length) interleavedData.push(block[i]);
      });
    }
    var interleavedEc = [];
    for (var i2 = 0; i2 < ecCount; i2++) {
      ecBlocks.forEach(function (ec) { interleavedEc.push(ec[i2]); });
    }
    return interleavedData.concat(interleavedEc);
  }

  // --- Matrix construction ---
  var ALIGNMENT_POSITIONS = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
    6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50]
  };

  function createMatrix(version) {
    var size = version * 4 + 17;
    var modules = [];
    for (var i = 0; i < size; i++) modules.push(new Array(size).fill(null));
    return { size: size, modules: modules };
  }

  function placeFinder(matrix, row, col) {
    for (var r = -1; r <= 7; r++) {
      for (var c = -1; c <= 7; c++) {
        var rr = row + r, cc = col + c;
        if (rr < 0 || rr >= matrix.size || cc < 0 || cc >= matrix.size) continue;
        var isDark =
          (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
          (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
          (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        matrix.modules[rr][cc] = isDark;
      }
    }
  }

  function placeTiming(matrix) {
    for (var i = 8; i < matrix.size - 8; i++) {
      if (matrix.modules[i][6] === null) matrix.modules[i][6] = i % 2 === 0;
      if (matrix.modules[6][i] === null) matrix.modules[6][i] = i % 2 === 0;
    }
  }

  function placeAlignment(matrix, version) {
    var positions = ALIGNMENT_POSITIONS[version] || [];
    positions.forEach(function (row) {
      positions.forEach(function (col) {
        if (matrix.modules[row][col] !== null) return; // skip near finder patterns
        for (var r = -2; r <= 2; r++) {
          for (var c = -2; c <= 2; c++) {
            var isDark = Math.max(Math.abs(r), Math.abs(c)) !== 1;
            matrix.modules[row + r][col + c] = isDark;
          }
        }
      });
    });
  }

  function placeDarkModule(matrix, version) {
    matrix.modules[4 * version + 9][8] = true;
  }

  function reserveFormatAreas(matrix) {
    for (var i = 0; i < 9; i++) {
      if (matrix.modules[8][i] === null) matrix.modules[8][i] = 'reserved';
      if (matrix.modules[i][8] === null) matrix.modules[i][8] = 'reserved';
    }
    for (var j = 0; j < 8; j++) {
      if (matrix.modules[matrix.size - 1 - j][8] === null) matrix.modules[matrix.size - 1 - j][8] = 'reserved';
      if (matrix.modules[8][matrix.size - 1 - j] === null) matrix.modules[8][matrix.size - 1 - j] = 'reserved';
    }
  }

  var MASK_FUNCTIONS = [
    function (r, c) { return (r + c) % 2 === 0; },
    function (r, c) { return r % 2 === 0; },
    function (r, c) { return c % 3 === 0; },
    function (r, c) { return (r + c) % 3 === 0; },
    function (r, c) { return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0; },
    function (r, c) { return ((r * c) % 2) + ((r * c) % 3) === 0; },
    function (r, c) { return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0; },
    function (r, c) { return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0; }
  ];

  function placeData(matrix, dataBytes, maskFn) {
    var bits = [];
    dataBytes.forEach(function (byte) {
      for (var i = 7; i >= 0; i--) bits.push((byte >>> i) & 1);
    });

    var bitIndex = 0;
    var dir = -1;
    var col = matrix.size - 1;
    while (col > 0) {
      if (col === 6) col--; // skip timing column
      for (var i = 0; i < matrix.size; i++) {
        var row = dir === -1 ? matrix.size - 1 - i : i;
        for (var c = 0; c < 2; c++) {
          var cc = col - c;
          if (matrix.modules[row][cc] !== null) continue;
          var bit = bitIndex < bits.length ? bits[bitIndex] : 0;
          bitIndex++;
          var masked = maskFn(row, cc) ? bit ^ 1 : bit;
          matrix.modules[row][cc] = masked === 1;
        }
      }
      dir = -dir;
      col -= 2;
    }
  }

  function computePenalty(matrix) {
    var size = matrix.size, m = matrix.modules, penalty = 0;
    // Rule 1: runs of 5+ same-colour modules in a row/column
    function runPenalty(getVal) {
      var p = 0;
      for (var i = 0; i < size; i++) {
        var runColor = null, runLen = 0;
        for (var j = 0; j < size; j++) {
          var v = getVal(i, j);
          if (v === runColor) {
            runLen++;
          } else {
            if (runLen >= 5) p += runLen - 2;
            runColor = v;
            runLen = 1;
          }
        }
        if (runLen >= 5) p += runLen - 2;
      }
      return p;
    }
    penalty += runPenalty(function (i, j) { return m[i][j]; });
    penalty += runPenalty(function (i, j) { return m[j][i]; });

    // Rule 2: 2x2 blocks of same colour
    for (var r = 0; r < size - 1; r++) {
      for (var c = 0; c < size - 1; c++) {
        var v = m[r][c];
        if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) penalty += 3;
      }
    }
    return penalty;
  }

  function applyBestMask(matrix, dataBytes) {
    var best = null, bestPenalty = Infinity, bestMask = 0;
    for (var mi = 0; mi < MASK_FUNCTIONS.length; mi++) {
      var trial = createMatrix(Math.round((matrix.size - 17) / 4));
      trial.modules = matrix.modules.map(function (row) { return row.slice(); });
      placeData(trial, dataBytes, MASK_FUNCTIONS[mi]);
      var p = computePenalty(trial);
      if (p < bestPenalty) { bestPenalty = p; best = trial; bestMask = mi; }
    }
    return { matrix: best, maskIndex: bestMask };
  }

  var FORMAT_INFO_M = {
    0: 0x5412, 1: 0x5125, 2: 0x5E7C, 3: 0x5B4B,
    4: 0x45F9, 5: 0x40CE, 6: 0x4F97, 7: 0x4AA0
  };

  function placeFormatInfo(matrix, maskIndex) {
    var bits = FORMAT_INFO_M[maskIndex];
    var size = matrix.size;
    for (var i = 0; i <= 5; i++) matrix.modules[8][i] = ((bits >> i) & 1) === 1;
    matrix.modules[8][7] = ((bits >> 6) & 1) === 1;
    matrix.modules[8][8] = ((bits >> 7) & 1) === 1;
    matrix.modules[7][8] = ((bits >> 8) & 1) === 1;
    for (var j = 9; j <= 14; j++) matrix.modules[14 - j + 9][8] = ((bits >> j) & 1) === 1;
    for (var k = 0; k <= 7; k++) matrix.modules[size - 1 - k][8] = ((bits >> k) & 1) === 1;
    for (var l = 8; l <= 14; l++) matrix.modules[8][size - 15 + l - 8] = ((bits >> l) & 1) === 1;
  }

  function generate(text) {
    var bytes = toUtf8Bytes(String(text));
    var version = chooseVersion(bytes.length);
    var dataCodewords = createDataBits(bytes, version);
    var allCodewords = buildCodewords(dataCodewords, version);

    var matrix = createMatrix(version);
    placeFinder(matrix, 0, 0);
    placeFinder(matrix, 0, matrix.size - 7);
    placeFinder(matrix, matrix.size - 7, 0);
    placeTiming(matrix);
    placeAlignment(matrix, version);
    placeDarkModule(matrix, version);
    reserveFormatAreas(matrix);

    var result = applyBestMask(matrix, allCodewords);
    placeFormatInfo(result.matrix, result.maskIndex);

    var modules = result.matrix.modules.map(function (row) {
      return row.map(function (v) { return v === true || v === 'reserved' && false ? !!v : !!v; });
    });

    return { modules: modules, size: result.matrix.size };
  }

  global.OutwilesQR = { generate: generate };
})(typeof window !== 'undefined' ? window : globalThis);
