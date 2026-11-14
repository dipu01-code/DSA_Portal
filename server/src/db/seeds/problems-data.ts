import type { Problem } from '@dsa-portal/core';

export const SEED_PROBLEMS: Problem[] = [
  // =========================================================================
  // TOPIC 1: Arrays
  // =========================================================================
  {
    id: 'two-sum',
    title: 'Two Sum',
    topic: 'Arrays',
    difficulty: 'Easy',
    description:
      'Given an array of integers `nums` and an integer `target`, return indices of the two numbers such that they add up to `target`. You may assume that each input would have exactly one solution, and you may not use the same element twice.',
    starterCode:
      'function solve(input) {\n  const { nums, target } = input;\n  // Your solution here\n  return [];\n}',
    testCases: [
      { input: { nums: [2, 7, 11, 15], target: 9 }, expected: [0, 1] },
      { input: { nums: [3, 2, 4], target: 6 }, expected: [1, 2] },
      { input: { nums: [3, 3], target: 6 }, expected: [0, 1] },
      { input: { nums: [-1, -2, -3, -4, -5], target: -8 }, expected: [2, 4] },
      { input: { nums: [0, 4, 3, 0], target: 0 }, expected: [0, 3] },
    ],
    hints: [
      { level: 1, content: 'A brute force approach checks all pairs, taking O(n^2) time.' },
      { level: 2, content: 'Can you use a hash map to look up the complement in O(1) time?' },
      {
        level: 3,
        content:
          'Store each number and its index in a Map. For each element, check if target - num exists in the map.',
      },
    ],
    solution: {
      code: 'function solve(input) {\n  const { nums, target } = input;\n  const map = new Map();\n  for (let i = 0; i < nums.length; i++) {\n    const comp = target - nums[i];\n    if (map.has(comp)) return [map.get(comp), i];\n    map.set(nums[i], i);\n  }\n  return [];\n}',
      explanation:
        'We use a hash map to store each visited number and its index. As we iterate, we look up target - nums[i].\nTime Complexity: O(n)\nSpace Complexity: O(n)',
    },
  },
  {
    id: 'best-time-to-buy-and-sell-stock',
    title: 'Best Time to Buy and Sell Stock',
    topic: 'Arrays',
    difficulty: 'Easy',
    description:
      'You are given an array `prices` where `prices[i]` is the price of a given stock on the `i-th` day. You want to maximize your profit by choosing a single day to buy one stock and choosing a different day in the future to sell that stock. Return the maximum profit you can achieve.',
    starterCode:
      'function solve(input) {\n  const { prices } = input;\n  // Your solution here\n  return 0;\n}',
    testCases: [
      { input: { prices: [7, 1, 5, 3, 6, 4] }, expected: 5 },
      { input: { prices: [7, 6, 4, 3, 1] }, expected: 0 },
      { input: { prices: [2, 4, 1] }, expected: 2 },
      { input: { prices: [1] }, expected: 0 },
      { input: { prices: [3, 3, 3, 3] }, expected: 0 },
    ],
    hints: [
      { level: 1, content: 'Keep track of the minimum price observed so far as you iterate.' },
      { level: 2, content: 'At each day, the potential profit is prices[i] - minPrice.' },
      { level: 3, content: 'Maintain minPrice and maxProfit in a single pass through the array.' },
    ],
    solution: {
      code: 'function solve(input) {\n  const { prices } = input;\n  let minPrice = Infinity;\n  let maxProfit = 0;\n  for (const price of prices) {\n    if (price < minPrice) minPrice = price;\n    else if (price - minPrice > maxProfit) maxProfit = price - minPrice;\n  }\n  return maxProfit;\n}',
      explanation:
        'Track the minimum purchase price seen so far and compare the current profit with the maximum profit seen so far.\nTime Complexity: O(n)\nSpace Complexity: O(1)',
    },
  },
  {
    id: 'contains-duplicate',
    title: 'Contains Duplicate',
    topic: 'Arrays',
    difficulty: 'Easy',
    description:
      'Given an integer array `nums`, return `true` if any value appears at least twice in the array, and return `false` if every element is distinct.',
    starterCode:
      'function solve(input) {\n  const { nums } = input;\n  // Your solution here\n  return false;\n}',
    testCases: [
      { input: { nums: [1, 2, 3, 1] }, expected: true },
      { input: { nums: [1, 2, 3, 4] }, expected: false },
      { input: { nums: [1, 1, 1, 3, 3, 4, 3, 2, 4, 2] }, expected: true },
      { input: { nums: [] }, expected: false },
      { input: { nums: [-100, -100] }, expected: true },
    ],
    hints: [
      { level: 1, content: 'A set stores only unique values.' },
      {
        level: 2,
        content:
          'Compare the size of the set with the length of the array, or check set.has() during iteration.',
      },
      { level: 3, content: 'new Set(nums).size !== nums.length provides a clean one-liner.' },
    ],
    solution: {
      code: 'function solve(input) {\n  const { nums } = input;\n  return new Set(nums).size !== nums.length;\n}',
      explanation:
        'A Set removes duplicates. If the set size is smaller than the array length, duplicates exist.\nTime Complexity: O(n)\nSpace Complexity: O(n)',
    },
  },
  {
    id: 'product-of-array-except-self',
    title: 'Product of Array Except Self',
    topic: 'Arrays',
    difficulty: 'Medium',
    description:
      'Given an integer array `nums`, return an array `answer` such that `answer[i]` is equal to the product of all the elements of `nums` except `nums[i]`. The product of any prefix or suffix of `nums` is guaranteed to fit in a 32-bit integer. You must write an algorithm that runs in O(n) time and without using the division operation.',
    starterCode:
      'function solve(input) {\n  const { nums } = input;\n  // Your solution here\n  return [];\n}',
    testCases: [
      { input: { nums: [1, 2, 3, 4] }, expected: [24, 12, 8, 6] },
      { input: { nums: [-1, 1, 0, -3, 3] }, expected: [0, 0, 9, 0, 0] },
      { input: { nums: [2, 3] }, expected: [3, 2] },
      { input: { nums: [0, 0] }, expected: [0, 0] },
      { input: { nums: [5, 2, 0, 4] }, expected: [0, 0, 40, 0] },
    ],
    hints: [
      { level: 1, content: 'Can you precompute prefix products and suffix products?' },
      { level: 2, content: 'Prefix product up to i gives product of all elements to the left.' },
      {
        level: 3,
        content:
          'First pass computes left prefix products. Second pass iterates backwards accumulating right suffix products.',
      },
    ],
    solution: {
      code: 'function solve(input) {\n  const { nums } = input;\n  const n = nums.length;\n  const res = new Array(n).fill(1);\n  let left = 1;\n  for (let i = 0; i < n; i++) {\n    res[i] = left;\n    left *= nums[i];\n  }\n  let right = 1;\n  for (let i = n - 1; i >= 0; i--) {\n    res[i] *= right;\n    right *= nums[i];\n  }\n  return res;\n}',
      explanation:
        'Calculate prefix products from left to right, then multiply by running suffix products from right to left.\nTime Complexity: O(n)\nSpace Complexity: O(1) extra space excluding output array',
    },
  },
  {
    id: 'container-with-most-water',
    title: 'Container With Most Water',
    topic: 'Arrays',
    difficulty: 'Medium',
    description:
      'You are given an integer array `height` of length `n`. There are `n` vertical lines drawn such that the two endpoints of the `i-th` line are `(i, 0)` and `(i, height[i])`. Find two lines that together with the x-axis form a container, such that the container contains the most water. Return the maximum amount of water a container can store.',
    starterCode:
      'function solve(input) {\n  const { height } = input;\n  // Your solution here\n  return 0;\n}',
    testCases: [
      { input: { height: [1, 8, 6, 2, 5, 4, 8, 3, 7] }, expected: 49 },
      { input: { height: [1, 1] }, expected: 1 },
      { input: { height: [4, 3, 2, 1, 4] }, expected: 16 },
      { input: { height: [1, 2, 1] }, expected: 2 },
      { input: { height: [10, 9, 8, 7, 6, 5, 4, 3, 2, 1] }, expected: 25 },
    ],
    hints: [
      { level: 1, content: 'Start with the widest container using two pointers at the ends.' },
      {
        level: 2,
        content:
          'The area is limited by the shorter line: min(height[left], height[right]) * (right - left).',
      },
      {
        level: 3,
        content: 'Always move the pointer pointing to the shorter vertical line inward.',
      },
    ],
    solution: {
      code: 'function solve(input) {\n  const { height } = input;\n  let left = 0, right = height.length - 1;\n  let maxArea = 0;\n  while (left < right) {\n    const w = right - left;\n    const h = Math.min(height[left], height[right]);\n    maxArea = Math.max(maxArea, w * h);\n    if (height[left] < height[right]) left++;\n    else right--;\n  }\n  return maxArea;\n}',
      explanation:
        'Two pointers starting from both extremities. Move the pointer with the smaller height inward since moving the taller one cannot increase the area.\nTime Complexity: O(n)\nSpace Complexity: O(1)',
    },
  },

  // =========================================================================
  // TOPIC 2: Strings
  // =========================================================================
  {
    id: 'valid-anagram',
    title: 'Valid Anagram',
    topic: 'Strings',
    difficulty: 'Easy',
    description:
      'Given two strings `s` and `t`, return `true` if `t` is an anagram of `s`, and `false` otherwise. An anagram is a word or phrase formed by rearranging the letters of a different word or phrase.',
    starterCode:
      'function solve(input) {\n  const { s, t } = input;\n  // Your solution here\n  return false;\n}',
    testCases: [
      { input: { s: 'anagram', t: 'nagaram' }, expected: true },
      { input: { s: 'rat', t: 'car' }, expected: false },
      { input: { s: 'a', t: 'a' }, expected: true },
      { input: { s: 'ab', t: 'a' }, expected: false },
      { input: { s: 'listen', t: 'silent' }, expected: true },
    ],
    hints: [
      { level: 1, content: 'If the lengths of s and t differ, they cannot be anagrams.' },
      {
        level: 2,
        content: 'Count the frequency of each character in s and decrement for characters in t.',
      },
      { level: 3, content: 'Use an array of size 26 or a Map to track character counts.' },
    ],
    solution: {
      code: 'function solve(input) {\n  const { s, t } = input;\n  if (s.length !== t.length) return false;\n  const counts = {};\n  for (const c of s) counts[c] = (counts[c] || 0) + 1;\n  for (const c of t) {\n    if (!counts[c]) return false;\n    counts[c]--;\n  }\n  return true;\n}',
      explanation:
        'Frequency count using a hash map. Length mismatch early exit.\nTime Complexity: O(n)\nSpace Complexity: O(1) (at most 26 lowercase English letters)',
    },
  },
  {
    id: 'valid-palindrome',
    title: 'Valid Palindrome',
    topic: 'Strings',
    difficulty: 'Easy',
    description:
      'A phrase is a palindrome if, after converting all uppercase letters into lowercase letters and removing all non-alphanumeric characters, it reads the same forward and backward. Given a string `s`, return `true` if it is a palindrome, or `false` otherwise.',
    starterCode:
      'function solve(input) {\n  const { s } = input;\n  // Your solution here\n  return false;\n}',
    testCases: [
      { input: { s: 'A man, a plan, a canal: Panama' }, expected: true },
      { input: { s: 'race a car' }, expected: false },
      { input: { s: ' ' }, expected: true },
      { input: { s: '0P' }, expected: false },
      { input: { s: 'No lemon, no melon' }, expected: true },
    ],
    hints: [
      { level: 1, content: 'Clean the string by lowercasing and stripping non-alphanumerics.' },
      { level: 2, content: 'Use two pointers from both ends moving towards the center.' },
      {
        level: 3,
        content:
          'Cleaned string s === cleaned.split("").reverse().join("") or two pointer while(l < r).',
      },
    ],
    solution: {
      code: 'function solve(input) {\n  const { s } = input;\n  const cleaned = s.toLowerCase().replace(/[^a-z0-9]/g, "");\n  let l = 0, r = cleaned.length - 1;\n  while (l < r) {\n    if (cleaned[l] !== cleaned[r]) return false;\n    l++;\n    r--;\n  }\n  return true;\n}',
      explanation:
        'Clean string with regex, then verify with two pointers meeting in the center.\nTime Complexity: O(n)\nSpace Complexity: O(n)',
    },
  },
  {
    id: 'longest-substring-without-repeating-characters',
    title: 'Longest Substring Without Repeating Characters',
    topic: 'Strings',
    difficulty: 'Medium',
    description:
      'Given a string `s`, find the length of the longest substring without repeating characters.',
    starterCode:
      'function solve(input) {\n  const { s } = input;\n  // Your solution here\n  return 0;\n}',
    testCases: [
      { input: { s: 'abcabcbb' }, expected: 3 },
      { input: { s: 'bbbbb' }, expected: 1 },
      { input: { s: 'pwwkew' }, expected: 3 },
      { input: { s: '' }, expected: 0 },
      { input: { s: 'au' }, expected: 2 },
    ],
    hints: [
      { level: 1, content: 'Use a sliding window defined by two pointers [left, right].' },
      { level: 2, content: 'Track the last seen index of each character in a map.' },
      {
        level: 3,
        content: 'When a repeated character is encountered, jump the left pointer to lastSeen + 1.',
      },
    ],
    solution: {
      code: 'function solve(input) {\n  const { s } = input;\n  const seen = new Map();\n  let maxLen = 0, left = 0;\n  for (let right = 0; right < s.length; right++) {\n    const char = s[right];\n    if (seen.has(char) && seen.get(char) >= left) {\n      left = seen.get(char) + 1;\n    }\n    seen.set(char, right);\n    maxLen = Math.max(maxLen, right - left + 1);\n  }\n  return maxLen;\n}',
      explanation:
        'Sliding window with character index map. When duplicate is seen, slide left pointer past its last occurrence.\nTime Complexity: O(n)\nSpace Complexity: O(min(m, n)) where m is character set size',
    },
  },
  {
    id: 'longest-common-prefix',
    title: 'Longest Common Prefix',
    topic: 'Strings',
    difficulty: 'Easy',
    description:
      'Write a function to find the longest common prefix string amongst an array of strings. If there is no common prefix, return an empty string `""`.',
    starterCode:
      'function solve(input) {\n  const { strs } = input;\n  // Your solution here\n  return "";\n}',
    testCases: [
      { input: { strs: ['flower', 'flow', 'flight'] }, expected: 'fl' },
      { input: { strs: ['dog', 'racecar', 'car'] }, expected: '' },
      { input: { strs: ['interspecies', 'interstellar', 'interstate'] }, expected: 'inters' },
      { input: { strs: ['throne', 'throne'] }, expected: 'throne' },
      { input: { strs: ['a'] }, expected: 'a' },
    ],
    hints: [
      { level: 1, content: 'Start by assuming the first string is the common prefix.' },
      {
        level: 2,
        content: 'Trim the prefix from the end while the next string does not start with it.',
      },
      { level: 3, content: 'while (str.indexOf(prefix) !== 0) prefix = prefix.slice(0, -1).' },
    ],
    solution: {
      code: 'function solve(input) {\n  const { strs } = input;\n  if (!strs || strs.length === 0) return "";\n  let prefix = strs[0];\n  for (let i = 1; i < strs.length; i++) {\n    while (strs[i].indexOf(prefix) !== 0) {\n      prefix = prefix.slice(0, prefix.length - 1);\n      if (prefix === "") return "";\n    }\n  }\n  return prefix;\n}',
      explanation:
        'Horizontal scanning: compare prefix against each string, shortening the prefix until it matches.\nTime Complexity: O(S) where S is sum of all characters in strings\nSpace Complexity: O(1)',
    },
  },
  {
    id: 'string-to-integer-atoi',
    title: 'String to Integer (atoi)',
    topic: 'Strings',
    difficulty: 'Medium',
    description:
      'Implement the `myAtoi(string s)` function, which converts a string to a 32-bit signed integer. Whitespace is ignored, optional sign is parsed, digits are converted, and result is clamped to [-2^31, 2^31 - 1].',
    starterCode:
      'function solve(input) {\n  const { s } = input;\n  // Your solution here\n  return 0;\n}',
    testCases: [
      { input: { s: '42' }, expected: 42 },
      { input: { s: '   -42' }, expected: -42 },
      { input: { s: '4193 with words' }, expected: 4193 },
      { input: { s: '-91283472332' }, expected: -2147483648 },
      { input: { s: '+1' }, expected: 1 },
    ],
    hints: [
      { level: 1, content: 'Trim leading whitespace first.' },
      { level: 2, content: 'Check for "+" or "-" to determine sign.' },
      {
        level: 3,
        content:
          'Accumulate numeric digits until non-digit is hit, then clamp to 32-bit integer limits.',
      },
    ],
    solution: {
      code: 'function solve(input) {\n  const { s } = input;\n  let i = 0, sign = 1, res = 0;\n  const str = s.trim();\n  if (!str) return 0;\n  if (str[0] === "-") { sign = -1; i++; }\n  else if (str[0] === "+") { i++; }\n  while (i < str.length && str[i] >= "0" && str[i] <= "9") {\n    res = res * 10 + (str.charCodeAt(i) - 48);\n    i++;\n  }\n  res *= sign;\n  const INT_MAX = 2147483647, INT_MIN = -2147483648;\n  if (res > INT_MAX) return INT_MAX;\n  if (res < INT_MIN) return INT_MIN;\n  return res;\n}',
      explanation:
        'Sequential parsing: trim whitespace, read optional sign, consume digits, and clamp to 32-bit bounds.\nTime Complexity: O(n)\nSpace Complexity: O(1)',
    },
  },

  // =========================================================================
  // TOPIC 3: LinkedList
  // =========================================================================
  {
    id: 'reverse-linked-list',
    title: 'Reverse Linked List',
    topic: 'LinkedList',
    difficulty: 'Easy',
    description:
      'Given the `head` of a singly linked list represented as an array of values, reverse the list, and return the reversed list.',
    starterCode:
      'function solve(input) {\n  const { list } = input;\n  // Your solution here\n  return [];\n}',
    testCases: [
      { input: { list: [1, 2, 3, 4, 5] }, expected: [5, 4, 3, 2, 1] },
      { input: { list: [1, 2] }, expected: [2, 1] },
      { input: { list: [] }, expected: [] },
      { input: { list: [7] }, expected: [7] },
      { input: { list: [10, 20, 30] }, expected: [30, 20, 10] },
    ],
    hints: [
      {
        level: 1,
        content: 'Iterate through the list while maintaining a reference to the previous element.',
      },
      {
        level: 2,
        content:
          'In an iterative pointer approach, prev = null, curr = head. At each step, next = curr.next, curr.next = prev, prev = curr, curr = next.',
      },
      {
        level: 3,
        content:
          'For array representation, reversing in-place or unshifting produces the reversed sequence.',
      },
    ],
    solution: {
      code: 'function solve(input) {\n  const { list } = input;\n  const res = [];\n  for (let i = list.length - 1; i >= 0; i--) {\n    res.push(list[i]);\n  }\n  return res;\n}',
      explanation:
        'Reverse the linked list elements in linear time.\nTime Complexity: O(n)\nSpace Complexity: O(n)',
    },
  },
  {
    id: 'merge-two-sorted-lists',
    title: 'Merge Two Sorted Lists',
    topic: 'LinkedList',
    difficulty: 'Easy',
    description:
      'You are given the heads of two sorted linked lists `list1` and `list2` represented as arrays. Merge the two lists into one sorted list and return it.',
    starterCode:
      'function solve(input) {\n  const { list1, list2 } = input;\n  // Your solution here\n  return [];\n}',
    testCases: [
      { input: { list1: [1, 2, 4], list2: [1, 3, 4] }, expected: [1, 1, 2, 3, 4, 4] },
      { input: { list1: [], list2: [] }, expected: [] },
      { input: { list1: [], list2: [0] }, expected: [0] },
      { input: { list1: [5, 10], list2: [2, 3, 4] }, expected: [2, 3, 4, 5, 10] },
      { input: { list1: [1], list2: [2] }, expected: [1, 2] },
    ],
    hints: [
      { level: 1, content: 'Use two pointers to compare the current heads of both lists.' },
      { level: 2, content: 'Append the smaller element to the result and advance its pointer.' },
      {
        level: 3,
        content: 'Once one list is exhausted, append the remaining elements of the other list.',
      },
    ],
    solution: {
      code: 'function solve(input) {\n  const { list1, list2 } = input;\n  let i = 0, j = 0;\n  const res = [];\n  while (i < list1.length && j < list2.length) {\n    if (list1[i] <= list2[j]) res.push(list1[i++]);\n    else res.push(list2[j++]);\n  }\n  while (i < list1.length) res.push(list1[i++]);\n  while (j < list2.length) res.push(list2[j++]);\n  return res;\n}',
      explanation:
        'Merge step of MergeSort. Compare elements from both lists and take the smaller one.\nTime Complexity: O(n + m)\nSpace Complexity: O(n + m)',
    },
  },
  {
    id: 'linked-list-cycle',
    title: 'Linked List Cycle Detection',
    topic: 'LinkedList',
    difficulty: 'Easy',
    description:
      'Given an array `nodes` representing node values and `pos` representing the index that the tail connects to (-1 if no cycle), determine if the linked list has a cycle in it.',
    starterCode:
      'function solve(input) {\n  const { nodes, pos } = input;\n  // Your solution here\n  return false;\n}',
    testCases: [
      { input: { nodes: [3, 2, 0, -4], pos: 1 }, expected: true },
      { input: { nodes: [1, 2], pos: 0 }, expected: true },
      { input: { nodes: [1], pos: -1 }, expected: false },
      { input: { nodes: [], pos: -1 }, expected: false },
      { input: { nodes: [1, 2, 3, 4, 5], pos: -1 }, expected: false },
    ],
    hints: [
      { level: 1, content: 'Floyd’s Cycle-Finding Algorithm (Tortoise and Hare).' },
      {
        level: 2,
        content: 'If pos is -1, there is no cycle. If pos >= 0 and within bounds, a cycle exists.',
      },
      {
        level: 3,
        content:
          'Fast pointer moves 2 steps, slow pointer moves 1 step. If they meet, a cycle exists.',
      },
    ],
    solution: {
      code: 'function solve(input) {\n  const { nodes, pos } = input;\n  return pos >= 0 && pos < nodes.length;\n}',
      explanation:
        'Under pointer nodes, Floyds cycle detection uses fast and slow pointers. With pos representation, pos >= 0 indicates a loop.\nTime Complexity: O(1)\nSpace Complexity: O(1)',
    },
  },
  {
    id: 'middle-of-the-linked-list',
    title: 'Middle of the Linked List',
    topic: 'LinkedList',
    difficulty: 'Easy',
    description:
      'Given the `head` of a singly linked list represented as an array of values, return the middle node and all subsequent nodes. If there are two middle nodes, return the second middle node.',
    starterCode:
      'function solve(input) {\n  const { list } = input;\n  // Your solution here\n  return [];\n}',
    testCases: [
      { input: { list: [1, 2, 3, 4, 5] }, expected: [3, 4, 5] },
      { input: { list: [1, 2, 3, 4, 5, 6] }, expected: [4, 5, 6] },
      { input: { list: [1] }, expected: [1] },
      { input: { list: [1, 2] }, expected: [2] },
      { input: { list: [] }, expected: [] },
    ],
    hints: [
      { level: 1, content: 'Fast and slow pointer approach.' },
      { level: 2, content: 'Fast pointer moves twice as fast as slow pointer.' },
      {
        level: 3,
        content:
          'When fast reaches the end, slow is at the middle. For array, slice from Math.floor(len / 2).',
      },
    ],
    solution: {
      code: 'function solve(input) {\n  const { list } = input;\n  const mid = Math.floor(list.length / 2);\n  return list.slice(mid);\n}',
      explanation:
        'Finding middle index via two pointers or Math.floor(n / 2).\nTime Complexity: O(n)\nSpace Complexity: O(n)',
    },
  },
  {
    id: 'remove-nth-node-from-end-of-list',
    title: 'Remove Nth Node From End of List',
    topic: 'LinkedList',
    difficulty: 'Medium',
    description:
      'Given the `head` of a linked list represented as an array and an integer `n`, remove the `n-th` node from the end of the list and return its head.',
    starterCode:
      'function solve(input) {\n  const { list, n } = input;\n  // Your solution here\n  return [];\n}',
    testCases: [
      { input: { list: [1, 2, 3, 4, 5], n: 2 }, expected: [1, 2, 3, 5] },
      { input: { list: [1], n: 1 }, expected: [] },
      { input: { list: [1, 2], n: 1 }, expected: [1] },
      { input: { list: [1, 2], n: 2 }, expected: [2] },
      { input: { list: [1, 2, 3], n: 3 }, expected: [2, 3] },
    ],
    hints: [
      { level: 1, content: 'Use two pointers separated by n steps.' },
      {
        level: 2,
        content: 'Advance first pointer n steps ahead, then move both until first hits the end.',
      },
      { level: 3, content: 'Target index from start is list.length - n.' },
    ],
    solution: {
      code: 'function solve(input) {\n  const { list, n } = input;\n  const idx = list.length - n;\n  return [...list.slice(0, idx), ...list.slice(idx + 1)];\n}',
      explanation:
        'Two-pointer sliding window or index calculation to remove node at list.length - n.\nTime Complexity: O(n)\nSpace Complexity: O(n)',
    },
  },

  // =========================================================================
  // TOPIC 4: Trees
  // =========================================================================
  {
    id: 'maximum-depth-of-binary-tree',
    title: 'Maximum Depth of Binary Tree',
    topic: 'Trees',
    difficulty: 'Easy',
    description:
      'Given a binary tree represented as an array in level-order (with `null` for missing nodes), return its maximum depth. A binary tree’s maximum depth is the number of nodes along the longest path from the root node down to the farthest leaf node. The array is in heap order: the children of the node at index `i` are at indexes `2i + 1` and `2i + 2`, and `null` means no node there.',
    starterCode:
      'function solve(input) {\n  const { tree } = input;\n  // Your solution here\n  return 0;\n}',
    testCases: [
      { input: { tree: [3, 9, 20, null, null, 15, 7] }, expected: 3 },
      { input: { tree: [1, null, 2] }, expected: 2 },
      { input: { tree: [] }, expected: 0 },
      { input: { tree: [0] }, expected: 1 },
      { input: { tree: [1, 2, 3, 4, 5] }, expected: 3 },
    ],
    hints: [
      { level: 1, content: 'Recursive depth: 1 + max(depth(left), depth(right)).' },
      {
        level: 2,
        content: 'For array representation, node at index i has children at 2*i + 1 and 2*i + 2.',
      },
      {
        level: 3,
        content:
          'Recursive helper: function getDepth(i) { if (i >= tree.length || tree[i] === null) return 0; return 1 + Math.max(getDepth(2*i+1), getDepth(2*i+2)); }.',
      },
    ],
    solution: {
      code: 'function solve(input) {\n  const { tree } = input;\n  if (!tree || tree.length === 0 || tree[0] === null) return 0;\n  function depth(idx) {\n    if (idx >= tree.length || tree[idx] === null || tree[idx] === undefined) return 0;\n    return 1 + Math.max(depth(2 * idx + 1), depth(2 * idx + 2));\n  }\n  return depth(0);\n}',
      explanation:
        'Recursive DFS traversal checking child nodes at 2i + 1 and 2i + 2.\nTime Complexity: O(n)\nSpace Complexity: O(h) where h is tree height',
    },
  },
  {
    id: 'invert-binary-tree',
    title: 'Invert Binary Tree',
    topic: 'Trees',
    difficulty: 'Easy',
    description:
      'Given the root of a binary tree represented as an array in level-order, invert the tree, and return its array representation. The array is in heap order: the children of the node at index `i` are at indexes `2i + 1` and `2i + 2`, and `null` means no node there.',
    starterCode:
      'function solve(input) {\n  const { tree } = input;\n  // Your solution here\n  return [];\n}',
    testCases: [
      { input: { tree: [4, 2, 7, 1, 3, 6, 9] }, expected: [4, 7, 2, 9, 6, 3, 1] },
      { input: { tree: [2, 1, 3] }, expected: [2, 3, 1] },
      { input: { tree: [] }, expected: [] },
      { input: { tree: [1] }, expected: [1] },
      { input: { tree: [1, 2] }, expected: [1, null, 2] },
    ],
    hints: [
      { level: 1, content: 'Swap the left and right children of every node.' },
      { level: 2, content: 'Recursively invert the left subtree, then the right subtree.' },
      { level: 3, content: 'Can be done via DFS or BFS queue.' },
    ],
    solution: {
      code: 'function solve(input) {\n  const { tree } = input;\n  if (!tree || tree.length === 0) return [];\n  function invert(idx) {\n    if (idx >= tree.length || tree[idx] === null) return null;\n    const node = { val: tree[idx], left: invert(2 * idx + 1), right: invert(2 * idx + 2) };\n    const tmp = node.left; node.left = node.right; node.right = tmp;\n    return node;\n  }\n  const root = invert(0);\n  const res = [];\n  const q = [root];\n  while (q.length > 0) {\n    const curr = q.shift();\n    if (curr) {\n      res.push(curr.val);\n      q.push(curr.left);\n      q.push(curr.right);\n    } else {\n      res.push(null);\n    }\n  }\n  while (res.length > 0 && res[res.length - 1] === null) res.pop();\n  return res;\n}',
      explanation:
        'Invert binary tree by swapping left and right child pointers recursively.\nTime Complexity: O(n)\nSpace Complexity: O(n)',
    },
  },
  {
    id: 'same-tree',
    title: 'Same Tree',
    topic: 'Trees',
    difficulty: 'Easy',
    description:
      'Given the roots of two binary trees `p` and `q` represented as level-order arrays, write a function to check if they are the same or not. The array is in heap order: the children of the node at index `i` are at indexes `2i + 1` and `2i + 2`, and `null` means no node there.',
    starterCode:
      'function solve(input) {\n  const { p, q } = input;\n  // Your solution here\n  return false;\n}',
    testCases: [
      { input: { p: [1, 2, 3], q: [1, 2, 3] }, expected: true },
      { input: { p: [1, 2], q: [1, null, 2] }, expected: false },
      { input: { p: [1, 2, 1], q: [1, 1, 2] }, expected: false },
      { input: { p: [], q: [] }, expected: true },
      { input: { p: [10], q: [10] }, expected: true },
    ],
    hints: [
      {
        level: 1,
        content:
          'Two trees are identical if their root values match and their left/right subtrees match.',
      },
      { level: 2, content: 'Check base cases: both null = true, one null = false.' },
      { level: 3, content: 'Compare element-by-element in level order array.' },
    ],
    solution: {
      code: 'function solve(input) {\n  const { p, q } = input;\n  if (p.length !== q.length) return false;\n  for (let i = 0; i < p.length; i++) {\n    if (p[i] !== q[i]) return false;\n  }\n  return true;\n}',
      explanation:
        'Compare trees node by node. If values and structure match everywhere, they are identical.\nTime Complexity: O(n)\nSpace Complexity: O(1)',
    },
  },
  {
    id: 'binary-tree-level-order-traversal',
    title: 'Binary Tree Level Order Traversal',
    topic: 'Trees',
    difficulty: 'Medium',
    description:
      'Given the `root` of a binary tree represented as an array in level-order, return the level order traversal of its nodes values. (i.e., from left to right, level by level). The array is in heap order: the children of the node at index `i` are at indexes `2i + 1` and `2i + 2`, and `null` means no node there.',
    starterCode:
      'function solve(input) {\n  const { tree } = input;\n  // Your solution here\n  return [];\n}',
    testCases: [
      { input: { tree: [3, 9, 20, null, null, 15, 7] }, expected: [[3], [9, 20], [15, 7]] },
      { input: { tree: [1] }, expected: [[1]] },
      { input: { tree: [] }, expected: [] },
      { input: { tree: [1, 2, 3, 4, 5] }, expected: [[1], [2, 3], [4, 5]] },
      { input: { tree: [1, null, 2, null, null, null, 3] }, expected: [[1], [2], [3]] },
    ],
    hints: [
      { level: 1, content: 'Use a Queue for Breadth-First Search (BFS).' },
      { level: 2, content: 'At each level, record queue.length and process that many nodes.' },
      {
        level: 3,
        content:
          'For array representation, track level index: level 0 has [0], level 1 has [1, 2], etc.',
      },
    ],
    solution: {
      code: 'function solve(input) {\n  const { tree } = input;\n  if (!tree || tree.length === 0 || tree[0] === null) return [];\n  const res = [];\n  function dfs(idx, level) {\n    if (idx >= tree.length || tree[idx] === null || tree[idx] === undefined) return;\n    if (!res[level]) res[level] = [];\n    res[level].push(tree[idx]);\n    dfs(2 * idx + 1, level + 1);\n    dfs(2 * idx + 2, level + 1);\n  }\n  dfs(0, 0);\n  return res;\n}',
      explanation:
        'BFS or DFS with level index. Group node values into subarrays by their depth.\nTime Complexity: O(n)\nSpace Complexity: O(n)',
    },
  },
  {
    id: 'validate-binary-search-tree',
    title: 'Validate Binary Search Tree',
    topic: 'Trees',
    difficulty: 'Medium',
    description:
      'Given the root of a binary tree represented as an array, determine if it is a valid binary search tree (BST). A valid BST requires all left subtree nodes to be strictly less than the root, and all right subtree nodes to be strictly greater than the root. The array is in heap order: the children of the node at index `i` are at indexes `2i + 1` and `2i + 2`, and `null` means no node there.',
    starterCode:
      'function solve(input) {\n  const { tree } = input;\n  // Your solution here\n  return false;\n}',
    testCases: [
      { input: { tree: [2, 1, 3] }, expected: true },
      { input: { tree: [5, 1, 4, null, null, 3, 6] }, expected: false },
      { input: { tree: [10, 5, 15, null, null, 6, 20] }, expected: false },
      { input: { tree: [1] }, expected: true },
      { input: { tree: [] }, expected: true },
    ],
    hints: [
      { level: 1, content: 'Every node must satisfy a valid range: min < val < max.' },
      {
        level: 2,
        content:
          'Passing left: max bound becomes node.val. Passing right: min bound becomes node.val.',
      },
      {
        level: 3,
        content:
          'function validate(idx, min, max) { if (tree[idx] <= min || tree[idx] >= max) return false; ... }.',
      },
    ],
    solution: {
      code: 'function solve(input) {\n  const { tree } = input;\n  if (!tree || tree.length === 0) return true;\n  function validate(idx, min, max) {\n    if (idx >= tree.length || tree[idx] === null || tree[idx] === undefined) return true;\n    const val = tree[idx];\n    if (val <= min || val >= max) return false;\n    return validate(2 * idx + 1, min, val) && validate(2 * idx + 2, val, max);\n  }\n  return validate(0, -Infinity, Infinity);\n}',
      explanation:
        'DFS passing valid range bounds down to children. Left child bounded by (min, val), right child bounded by (val, max).\nTime Complexity: O(n)\nSpace Complexity: O(h)',
    },
  },

  // =========================================================================
  // TOPIC 5: Graphs
  // =========================================================================
  {
    id: 'number-of-islands',
    title: 'Number of Islands',
    topic: 'Graphs',
    difficulty: 'Medium',
    description:
      'Given an `m x n` 2D binary grid `grid` which represents a map of "1"s (land) and "0"s (water), return the number of islands. An island is surrounded by water and is formed by connecting adjacent lands horizontally or vertically.',
    starterCode:
      'function solve(input) {\n  const { grid } = input;\n  // Your solution here\n  return 0;\n}',
    testCases: [
      {
        input: {
          grid: [
            ['1', '1', '1', '1', '0'],
            ['1', '1', '0', '1', '0'],
            ['1', '1', '0', '0', '0'],
            ['0', '0', '0', '0', '0'],
          ],
        },
        expected: 1,
      },
      {
        input: {
          grid: [
            ['1', '1', '0', '0', '0'],
            ['1', '1', '0', '0', '0'],
            ['0', '0', '1', '0', '0'],
            ['0', '0', '0', '1', '1'],
          ],
        },
        expected: 3,
      },
      { input: { grid: [['1']] }, expected: 1 },
      { input: { grid: [['0']] }, expected: 0 },
      { input: { grid: [] }, expected: 0 },
    ],
    hints: [
      {
        level: 1,
        content:
          'Iterate through the grid. When you find a "1", increment island count and sink the island.',
      },
      { level: 2, content: 'Use DFS or BFS to visit and mark all connected "1"s as "0".' },
      { level: 3, content: 'dfs(r, c) explores (r+1,c), (r-1,c), (r,c+1), (r,c-1).' },
    ],
    solution: {
      code: 'function solve(input) {\n  const { grid } = input;\n  if (!grid || grid.length === 0) return 0;\n  const m = grid.length, n = grid[0].length;\n  let islands = 0;\n  function dfs(r, c) {\n    if (r < 0 || c < 0 || r >= m || c >= n || grid[r][c] !== "1") return;\n    grid[r][c] = "0";\n    dfs(r + 1, c);\n    dfs(r - 1, c);\n    dfs(r, c + 1);\n    dfs(r, c - 1);\n  }\n  for (let r = 0; r < m; r++) {\n    for (let c = 0; c < n; c++) {\n      if (grid[r][c] === "1") {\n        islands++;\n        dfs(r, c);\n      }\n    }\n  }\n  return islands;\n}',
      explanation:
        'DFS graph flood-fill. Sink connected land cells to 0 upon discovery.\nTime Complexity: O(m * n)\nSpace Complexity: O(m * n)',
    },
  },
  {
    id: 'flood-fill',
    title: 'Flood Fill',
    topic: 'Graphs',
    difficulty: 'Easy',
    description:
      'An image is represented by an `m x n` integer grid `image` where `image[i][j]` represents the pixel value. You are given `sr`, `sc`, and `color`. Perform a flood fill on the image starting from `(sr, sc)` replacing the starting pixel and all 4-directionally connected pixels of the same color with `color`.',
    starterCode:
      'function solve(input) {\n  const { image, sr, sc, color } = input;\n  // Your solution here\n  return [];\n}',
    testCases: [
      {
        input: {
          image: [
            [1, 1, 1],
            [1, 1, 0],
            [1, 0, 1],
          ],
          sr: 1,
          sc: 1,
          color: 2,
        },
        expected: [
          [2, 2, 2],
          [2, 2, 0],
          [2, 0, 1],
        ],
      },
      {
        input: {
          image: [
            [0, 0, 0],
            [0, 0, 0],
          ],
          sr: 0,
          sc: 0,
          color: 0,
        },
        expected: [
          [0, 0, 0],
          [0, 0, 0],
        ],
      },
      {
        input: { image: [[0]], sr: 0, sc: 0, color: 1 },
        expected: [[1]],
      },
      {
        input: {
          image: [
            [1, 2],
            [3, 4],
          ],
          sr: 1,
          sc: 1,
          color: 5,
        },
        expected: [
          [1, 2],
          [3, 5],
        ],
      },
      {
        input: {
          image: [
            [2, 2],
            [2, 2],
          ],
          sr: 0,
          sc: 1,
          color: 9,
        },
        expected: [
          [9, 9],
          [9, 9],
        ],
      },
    ],
    hints: [
      {
        level: 1,
        content: 'Check if the target pixel already has the new color (avoid infinite loop).',
      },
      { level: 2, content: 'Store originalColor = image[sr][sc].' },
      {
        level: 3,
        content: 'DFS to all 4 neighbors matching originalColor, setting them to color.',
      },
    ],
    solution: {
      code: 'function solve(input) {\n  const { image, sr, sc, color } = input;\n  const orig = image[sr][sc];\n  if (orig === color) return image;\n  const m = image.length, n = image[0].length;\n  function dfs(r, c) {\n    if (r < 0 || c < 0 || r >= m || c >= n || image[r][c] !== orig) return;\n    image[r][c] = color;\n    dfs(r + 1, c);\n    dfs(r - 1, c);\n    dfs(r, c + 1);\n    dfs(r, c - 1);\n  }\n  dfs(sr, sc);\n  return image;\n}',
      explanation:
        'Standard flood fill via DFS traversal. Replaces original color with target color on adjacent cells.\nTime Complexity: O(m * n)\nSpace Complexity: O(m * n)',
    },
  },
  {
    id: 'clone-graph',
    title: 'Clone Graph',
    topic: 'Graphs',
    difficulty: 'Medium',
    description:
      'Given an adjacency list representing a connected undirected graph, return a deep copy (clone) of the graph representation.',
    starterCode:
      'function solve(input) {\n  const { adjList } = input;\n  // Your solution here\n  return [];\n}',
    testCases: [
      {
        input: {
          adjList: [
            [2, 4],
            [1, 3],
            [2, 4],
            [1, 3],
          ],
        },
        expected: [
          [2, 4],
          [1, 3],
          [2, 4],
          [1, 3],
        ],
      },
      { input: { adjList: [[]] }, expected: [[]] },
      { input: { adjList: [] }, expected: [] },
      { input: { adjList: [[2], [1]] }, expected: [[2], [1]] },
      {
        input: {
          adjList: [
            [2, 3],
            [1, 3],
            [1, 2],
          ],
        },
        expected: [
          [2, 3],
          [1, 3],
          [1, 2],
        ],
      },
    ],
    hints: [
      { level: 1, content: 'Use a hash map to map original nodes to their cloned copies.' },
      { level: 2, content: 'DFS or BFS traversing every edge.' },
      {
        level: 3,
        content:
          'Deep copying an adjacency list creates an independent replica of all neighbor arrays.',
      },
    ],
    solution: {
      code: 'function solve(input) {\n  const { adjList } = input;\n  if (!adjList || adjList.length === 0) return [];\n  return adjList.map(neighbors => [...neighbors]);\n}',
      explanation:
        'Deep clone of graph adjacency list. Creates distinct array references for all node neighbor lists.\nTime Complexity: O(V + E)\nSpace Complexity: O(V + E)',
    },
  },
  {
    id: 'course-schedule',
    title: 'Course Schedule',
    topic: 'Graphs',
    difficulty: 'Medium',
    description:
      'There are a total of `numCourses` courses you have to take, labeled from 0 to `numCourses - 1`. You are given an array `prerequisites` where `prerequisites[i] = [a, b]` indicates you must take course `b` first if you want to take course `a`. Return `true` if you can finish all courses, or `false` otherwise.',
    starterCode:
      'function solve(input) {\n  const { numCourses, prerequisites } = input;\n  // Your solution here\n  return false;\n}',
    testCases: [
      { input: { numCourses: 2, prerequisites: [[1, 0]] }, expected: true },
      {
        input: {
          numCourses: 2,
          prerequisites: [
            [1, 0],
            [0, 1],
          ],
        },
        expected: false,
      },
      { input: { numCourses: 1, prerequisites: [] }, expected: true },
      {
        input: {
          numCourses: 3,
          prerequisites: [
            [0, 1],
            [1, 2],
          ],
        },
        expected: true,
      },
      {
        input: {
          numCourses: 3,
          prerequisites: [
            [0, 1],
            [1, 2],
            [2, 0],
          ],
        },
        expected: false,
      },
    ],
    hints: [
      { level: 1, content: 'This problem is equivalent to detecting a cycle in a directed graph.' },
      {
        level: 2,
        content: 'Kahn’s algorithm using indegree array or 3-color DFS cycle detection.',
      },
      {
        level: 3,
        content:
          'Maintain in-degree for each course. Enqueue courses with in-degree 0. If processed count === numCourses, return true.',
      },
    ],
    solution: {
      code: 'function solve(input) {\n  const { numCourses, prerequisites } = input;\n  const inDegree = new Array(numCourses).fill(0);\n  const adj = Array.from({ length: numCourses }, () => []);\n  for (const [dest, src] of prerequisites) {\n    adj[src].push(dest);\n    inDegree[dest]++;\n  }\n  const q = [];\n  for (let i = 0; i < numCourses; i++) {\n    if (inDegree[i] === 0) q.push(i);\n  }\n  let count = 0;\n  while (q.length > 0) {\n    const node = q.shift();\n    count++;\n    for (const neighbor of adj[node]) {\n      inDegree[neighbor]--;\n      if (inDegree[neighbor] === 0) q.push(neighbor);\n    }\n  }\n  return count === numCourses;\n}',
      explanation:
        'Kahns Topological Sort algorithm. A graph has no cycles iff all nodes can be processed with in-degree 0.\nTime Complexity: O(V + E)\nSpace Complexity: O(V + E)',
    },
  },
  {
    id: 'word-ladder',
    title: 'Word Ladder',
    topic: 'Graphs',
    difficulty: 'Hard',
    description:
      'A transformation sequence from word `beginWord` to word `endWord` using a dictionary `wordList` is a sequence of words `beginWord -> s1 -> s2 -> ... -> sk` such that every adjacent pair differs by exactly one letter. Return the number of words in the shortest transformation sequence, or `0` if no such sequence exists.',
    starterCode:
      'function solve(input) {\n  const { beginWord, endWord, wordList } = input;\n  // Your solution here\n  return 0;\n}',
    testCases: [
      {
        input: {
          beginWord: 'hit',
          endWord: 'cog',
          wordList: ['hot', 'dot', 'dog', 'lot', 'log', 'cog'],
        },
        expected: 5,
      },
      {
        input: {
          beginWord: 'hit',
          endWord: 'cog',
          wordList: ['hot', 'dot', 'dog', 'lot', 'log'],
        },
        expected: 0,
      },
      { input: { beginWord: 'a', endWord: 'c', wordList: ['a', 'b', 'c'] }, expected: 2 },
      { input: { beginWord: 'hot', endWord: 'dog', wordList: ['hot', 'dog'] }, expected: 0 },
      {
        input: {
          beginWord: 'cold',
          endWord: 'warm',
          wordList: ['cold', 'cord', 'card', 'ward', 'warm'],
        },
        expected: 5,
      },
    ],
    hints: [
      { level: 1, content: 'Shortest path in an unweighted graph is solved using BFS.' },
      {
        level: 2,
        content: 'Treat each word as a node. Edges exist between words differing by 1 char.',
      },
      {
        level: 3,
        content: 'At each BFS step, mutate each letter from "a" to "z" and look up in a Set.',
      },
    ],
    solution: {
      code: 'function solve(input) {\n  const { beginWord, endWord, wordList } = input;\n  const wordSet = new Set(wordList);\n  if (!wordSet.has(endWord)) return 0;\n  let queue = [[beginWord, 1]];\n  const visited = new Set([beginWord]);\n  while (queue.length > 0) {\n    const [word, level] = queue.shift();\n    if (word === endWord) return level;\n    for (let i = 0; i < word.length; i++) {\n      for (let c = 97; c <= 122; c++) {\n        const char = String.fromCharCode(c);\n        const nextWord = word.slice(0, i) + char + word.slice(i + 1);\n        if (wordSet.has(nextWord) && !visited.has(nextWord)) {\n          visited.add(nextWord);\n          queue.push([nextWord, level + 1]);\n        }\n      }\n    }\n  }\n  return 0;\n}',
      explanation:
        'Breadth-First Search (BFS) explores words layer by layer, guaranteeing the shortest sequence.\nTime Complexity: O(M^2 * N) where M is word length and N is word list size\nSpace Complexity: O(M * N)',
    },
  },

  // =========================================================================
  // TOPIC 6: Dynamic Programming
  // =========================================================================
  {
    id: 'climbing-stairs',
    title: 'Climbing Stairs',
    topic: 'Dynamic Programming',
    difficulty: 'Easy',
    description:
      'You are climbing a staircase. It takes `n` steps to reach the top. Each time you can either climb 1 or 2 steps. In how many distinct ways can you climb to the top?',
    starterCode:
      'function solve(input) {\n  const { n } = input;\n  // Your solution here\n  return 0;\n}',
    testCases: [
      { input: { n: 2 }, expected: 2 },
      { input: { n: 3 }, expected: 3 },
      { input: { n: 1 }, expected: 1 },
      { input: { n: 4 }, expected: 5 },
      { input: { n: 5 }, expected: 8 },
    ],
    hints: [
      { level: 1, content: 'To reach step n, you can either step from n-1 or n-2.' },
      { level: 2, content: 'dp[n] = dp[n-1] + dp[n-2], which matches the Fibonacci sequence.' },
      { level: 3, content: 'Iterate with two variables (a = 1, b = 2) up to n.' },
    ],
    solution: {
      code: 'function solve(input) {\n  const { n } = input;\n  if (n <= 2) return n;\n  let prev2 = 1, prev1 = 2;\n  for (let i = 3; i <= n; i++) {\n    const curr = prev1 + prev2;\n    prev2 = prev1;\n    prev1 = curr;\n  }\n  return prev1;\n}',
      explanation:
        'State transition dp[i] = dp[i-1] + dp[i-2]. Solved in O(1) space using two rolling variables.\nTime Complexity: O(n)\nSpace Complexity: O(1)',
    },
  },
  {
    id: 'coin-change',
    title: 'Coin Change',
    topic: 'Dynamic Programming',
    difficulty: 'Medium',
    description:
      'You are given an integer array `coins` representing coins of different denominations and an integer `amount` representing a total amount of money. Return the fewest number of coins that you need to make up that amount. If that amount of money cannot be made up, return `-1`.',
    starterCode:
      'function solve(input) {\n  const { coins, amount } = input;\n  // Your solution here\n  return -1;\n}',
    testCases: [
      { input: { coins: [1, 2, 5], amount: 11 }, expected: 3 },
      { input: { coins: [2], amount: 3 }, expected: -1 },
      { input: { coins: [1], amount: 0 }, expected: 0 },
      { input: { coins: [1], amount: 2 }, expected: 2 },
      { input: { coins: [2, 5, 10, 1], amount: 27 }, expected: 4 },
    ],
    hints: [
      { level: 1, content: 'Define dp[i] as the minimum coins needed to make amount i.' },
      {
        level: 2,
        content: 'Initialize dp array of size amount + 1 filled with Infinity, with dp[0] = 0.',
      },
      {
        level: 3,
        content: 'For each coin: for i from coin to amount: dp[i] = min(dp[i], dp[i - coin] + 1).',
      },
    ],
    solution: {
      code: 'function solve(input) {\n  const { coins, amount } = input;\n  const dp = new Array(amount + 1).fill(Infinity);\n  dp[0] = 0;\n  for (let i = 1; i <= amount; i++) {\n    for (const c of coins) {\n      if (i - c >= 0) {\n        dp[i] = Math.min(dp[i], dp[i - c] + 1);\n      }\n    }\n  }\n  return dp[amount] === Infinity ? -1 : dp[amount];\n}',
      explanation:
        'Bottom-up dynamic programming. dp[i] computes fewest coins to make amount i.\nTime Complexity: O(amount * len(coins))\nSpace Complexity: O(amount)',
    },
  },
  {
    id: 'house-robber',
    title: 'House Robber',
    topic: 'Dynamic Programming',
    difficulty: 'Medium',
    description:
      'You are a professional robber planning to rob houses along a street. Each house has a certain amount of money stashed. Adjacent houses have security systems connected that automatically contact the police if two adjacent houses were broken into on the same night. Return the maximum amount of money you can rob tonight without alerting the police.',
    starterCode:
      'function solve(input) {\n  const { nums } = input;\n  // Your solution here\n  return 0;\n}',
    testCases: [
      { input: { nums: [1, 2, 3, 1] }, expected: 4 },
      { input: { nums: [2, 7, 9, 3, 1] }, expected: 12 },
      { input: { nums: [0] }, expected: 0 },
      { input: { nums: [2, 1, 1, 2] }, expected: 4 },
      { input: { nums: [5] }, expected: 5 },
    ],
    hints: [
      {
        level: 1,
        content: 'At each house i, you either rob it (nums[i] + rob(i-2)) or skip it (rob(i-1)).',
      },
      { level: 2, content: 'dp[i] = max(dp[i-1], dp[i-2] + nums[i]).' },
      { level: 3, content: 'Only two previous values are required, giving O(1) space.' },
    ],
    solution: {
      code: 'function solve(input) {\n  const { nums } = input;\n  if (nums.length === 0) return 0;\n  if (nums.length === 1) return nums[0];\n  let prev2 = 0, prev1 = 0;\n  for (const n of nums) {\n    const temp = Math.max(prev1, prev2 + n);\n    prev2 = prev1;\n    prev1 = temp;\n  }\n  return prev1;\n}',
      explanation:
        'State transition dp[i] = max(dp[i-1], dp[i-2] + nums[i]) maintained with two rolling variables.\nTime Complexity: O(n)\nSpace Complexity: O(1)',
    },
  },
  {
    id: 'longest-increasing-subsequence',
    title: 'Longest Increasing Subsequence',
    topic: 'Dynamic Programming',
    difficulty: 'Medium',
    description:
      'Given an integer array `nums`, return the length of the longest strictly increasing subsequence.',
    starterCode:
      'function solve(input) {\n  const { nums } = input;\n  // Your solution here\n  return 0;\n}',
    testCases: [
      { input: { nums: [10, 9, 2, 5, 3, 7, 101, 18] }, expected: 4 },
      { input: { nums: [0, 1, 0, 3, 2, 3] }, expected: 4 },
      { input: { nums: [7, 7, 7, 7, 7, 7, 7] }, expected: 1 },
      { input: { nums: [1] }, expected: 1 },
      { input: { nums: [4, 10, 4, 3, 8, 9] }, expected: 3 },
    ],
    hints: [
      { level: 1, content: 'dp[i] = length of LIS ending at index i.' },
      { level: 2, content: 'For each j < i: if nums[j] < nums[i], dp[i] = max(dp[i], dp[j] + 1).' },
      {
        level: 3,
        content:
          'Can be solved in O(n^2) via standard DP, or O(n log n) with patient sorting / binary search.',
      },
    ],
    solution: {
      code: 'function solve(input) {\n  const { nums } = input;\n  if (nums.length === 0) return 0;\n  const dp = new Array(nums.length).fill(1);\n  let maxLen = 1;\n  for (let i = 1; i < nums.length; i++) {\n    for (let j = 0; j < i; j++) {\n      if (nums[j] < nums[i]) {\n        dp[i] = Math.max(dp[i], dp[j] + 1);\n      }\n    }\n    maxLen = Math.max(maxLen, dp[i]);\n  }\n  return maxLen;\n}',
      explanation:
        'Classic O(n^2) dynamic programming checking all preceding smaller elements.\nTime Complexity: O(n^2)\nSpace Complexity: O(n)',
    },
  },
  {
    id: 'edit-distance',
    title: 'Edit Distance',
    topic: 'Dynamic Programming',
    difficulty: 'Hard',
    description:
      'Given two strings `word1` and `word2`, return the minimum number of operations required to convert `word1` to `word2`. Permitted operations: insert a character, delete a character, replace a character.',
    starterCode:
      'function solve(input) {\n  const { word1, word2 } = input;\n  // Your solution here\n  return 0;\n}',
    testCases: [
      { input: { word1: 'horse', word2: 'ros' }, expected: 3 },
      { input: { word1: 'intention', word2: 'execution' }, expected: 5 },
      { input: { word1: '', word2: 'a' }, expected: 1 },
      { input: { word1: 'abc', word2: 'abc' }, expected: 0 },
      { input: { word1: 'plasma', word2: 'altruism' }, expected: 6 },
    ],
    hints: [
      {
        level: 1,
        content: '2D DP table where dp[i][j] is the distance between word1[0..i] and word2[0..j].',
      },
      { level: 2, content: 'If chars match, dp[i][j] = dp[i-1][j-1].' },
      {
        level: 3,
        content:
          'If chars differ, dp[i][j] = 1 + min(insert: dp[i][j-1], delete: dp[i-1][j], replace: dp[i-1][j-1]).',
      },
    ],
    solution: {
      code: 'function solve(input) {\n  const { word1, word2 } = input;\n  const m = word1.length, n = word2.length;\n  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));\n  for (let i = 0; i <= m; i++) dp[i][0] = i;\n  for (let j = 0; j <= n; j++) dp[0][j] = j;\n  for (let i = 1; i <= m; i++) {\n    for (let j = 1; j <= n; j++) {\n      if (word1[i - 1] === word2[j - 1]) dp[i][j] = dp[i - 1][j - 1];\n      else dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);\n    }\n  }\n  return dp[m][n];\n}',
      explanation:
        'Levenshtein distance 2D dynamic programming.\nTime Complexity: O(m * n)\nSpace Complexity: O(m * n)',
    },
  },

  // =========================================================================
  // TOPIC 7: Sorting
  // =========================================================================
  {
    id: 'merge-intervals',
    title: 'Merge Intervals',
    topic: 'Sorting',
    difficulty: 'Medium',
    description:
      'Given an array of `intervals` where `intervals[i] = [starti, endi]`, merge all overlapping intervals, and return an array of the non-overlapping intervals that cover all the intervals in the input.',
    starterCode:
      'function solve(input) {\n  const { intervals } = input;\n  // Your solution here\n  return [];\n}',
    testCases: [
      {
        input: {
          intervals: [
            [1, 3],
            [2, 6],
            [8, 10],
            [15, 18],
          ],
        },
        expected: [
          [1, 6],
          [8, 10],
          [15, 18],
        ],
      },
      {
        input: {
          intervals: [
            [1, 4],
            [4, 5],
          ],
        },
        expected: [[1, 5]],
      },
      {
        input: {
          intervals: [
            [1, 4],
            [0, 4],
          ],
        },
        expected: [[0, 4]],
      },
      {
        input: {
          intervals: [
            [1, 4],
            [2, 3],
          ],
        },
        expected: [[1, 4]],
      },
      { input: { intervals: [] }, expected: [] },
    ],
    hints: [
      { level: 1, content: 'Sort the intervals by their start time.' },
      {
        level: 2,
        content: 'Iterate through: if current interval overlaps with last merged, merge them.',
      },
      {
        level: 3,
        content:
          'Overlaps when current.start <= lastMerged.end. Merged end is max(lastMerged.end, current.end).',
      },
    ],
    solution: {
      code: 'function solve(input) {\n  const { intervals } = input;\n  if (intervals.length === 0) return [];\n  intervals.sort((a, b) => a[0] - b[0]);\n  const merged = [intervals[0]];\n  for (let i = 1; i < intervals.length; i++) {\n    const curr = intervals[i];\n    const last = merged[merged.length - 1];\n    if (curr[0] <= last[1]) {\n      last[1] = Math.max(last[1], curr[1]);\n    } else {\n      merged.push(curr);\n    }\n  }\n  return merged;\n}',
      explanation:
        'Sort intervals by start time, then merge overlapping adjacent pairs.\nTime Complexity: O(n log n)\nSpace Complexity: O(n)',
    },
  },
  {
    id: 'sort-colors',
    title: 'Sort Colors',
    topic: 'Sorting',
    difficulty: 'Medium',
    description:
      'Given an array `nums` with `n` objects colored red, white, or blue, sort them in-place so that objects of the same color are adjacent, with the colors in the order red (0), white (1), and blue (2). Return the sorted array.',
    starterCode:
      'function solve(input) {\n  const { nums } = input;\n  // Your solution here\n  return nums;\n}',
    testCases: [
      { input: { nums: [2, 0, 2, 1, 1, 0] }, expected: [0, 0, 1, 1, 2, 2] },
      { input: { nums: [2, 0, 1] }, expected: [0, 1, 2] },
      { input: { nums: [0] }, expected: [0] },
      { input: { nums: [1] }, expected: [1] },
      { input: { nums: [2, 2, 1, 0] }, expected: [0, 1, 2, 2] },
    ],
    hints: [
      { level: 1, content: 'Dutch National Flag algorithm.' },
      { level: 2, content: 'Maintain three pointers: low, mid, high.' },
      {
        level: 3,
        content:
          'If nums[mid] === 0, swap(low, mid), low++, mid++. If nums[mid] === 1, mid++. If nums[mid] === 2, swap(mid, high), high--.',
      },
    ],
    solution: {
      code: 'function solve(input) {\n  const { nums } = input;\n  let low = 0, mid = 0, high = nums.length - 1;\n  while (mid <= high) {\n    if (nums[mid] === 0) {\n      [nums[low], nums[mid]] = [nums[mid], nums[low]];\n      low++; mid++;\n    } else if (nums[mid] === 1) {\n      mid++;\n    } else {\n      [nums[mid], nums[high]] = [nums[high], nums[mid]];\n      high--;\n    }\n  }\n  return nums;\n}',
      explanation:
        'Dutch National Flag 3-pointer partition in a single pass.\nTime Complexity: O(n)\nSpace Complexity: O(1)',
    },
  },
  {
    id: 'top-k-frequent-elements',
    title: 'Top K Frequent Elements',
    topic: 'Sorting',
    difficulty: 'Medium',
    description:
      'Given an integer array `nums` and an integer `k`, return the `k` most frequent elements in descending order of frequency.',
    starterCode:
      'function solve(input) {\n  const { nums, k } = input;\n  // Your solution here\n  return [];\n}',
    testCases: [
      { input: { nums: [1, 1, 1, 2, 2, 3], k: 2 }, expected: [1, 2] },
      { input: { nums: [1], k: 1 }, expected: [1] },
      { input: { nums: [4, 4, 4, 6, 6, 7], k: 1 }, expected: [4] },
      { input: { nums: [1, 2, 3, 4], k: 2 }, expected: [1, 2] },
      { input: { nums: [-1, -1, 2, 2, 2], k: 2 }, expected: [2, -1] },
    ],
    hints: [
      { level: 1, content: 'Count element frequencies using a Hash Map.' },
      { level: 2, content: 'Sort the distinct elements by frequency.' },
      {
        level: 3,
        content: 'Alternatively, Bucket Sort achieves O(n) time by indexing frequency arrays.',
      },
    ],
    solution: {
      code: 'function solve(input) {\n  const { nums, k } = input;\n  const count = new Map();\n  for (const n of nums) count.set(n, (count.get(n) || 0) + 1);\n  const sorted = [...count.entries()].sort((a, b) => b[1] - a[1]);\n  return sorted.slice(0, k).map(e => e[0]);\n}',
      explanation:
        'Frequency map sorted descending by frequency, taking top k elements.\nTime Complexity: O(n log n)\nSpace Complexity: O(n)',
    },
  },
  {
    id: 'kth-largest-element-in-an-array',
    title: 'Kth Largest Element in an Array',
    topic: 'Sorting',
    difficulty: 'Medium',
    description:
      'Given an integer array `nums` and an integer `k`, return the `k-th` largest element in the array. Can you solve it without sorting the entire array?',
    starterCode:
      'function solve(input) {\n  const { nums, k } = input;\n  // Your solution here\n  return 0;\n}',
    testCases: [
      { input: { nums: [3, 2, 1, 5, 6, 4], k: 2 }, expected: 5 },
      { input: { nums: [3, 2, 3, 1, 2, 4, 5, 5, 6], k: 4 }, expected: 4 },
      { input: { nums: [1], k: 1 }, expected: 1 },
      { input: { nums: [-1, 2, 0], k: 1 }, expected: 2 },
      { input: { nums: [7, 6, 5, 4, 3, 2, 1], k: 5 }, expected: 3 },
    ],
    hints: [
      { level: 1, content: 'Sorting the array in descending order yields nums[k-1].' },
      { level: 2, content: 'A min-heap of size k keeps the top k elements in O(n log k).' },
      { level: 3, content: 'Quickselect finds the kth element in average O(n) time.' },
    ],
    solution: {
      code: 'function solve(input) {\n  const { nums, k } = input;\n  nums.sort((a, b) => b - a);\n  return nums[k - 1];\n}',
      explanation:
        'Sort descending and return element at index k - 1.\nTime Complexity: O(n log n)\nSpace Complexity: O(1)',
    },
  },
  {
    id: 'largest-number',
    title: 'Largest Number',
    topic: 'Sorting',
    difficulty: 'Medium',
    description:
      'Given a list of non-negative integers `nums`, arrange them such that they form the largest number and return it as a string.',
    starterCode:
      'function solve(input) {\n  const { nums } = input;\n  // Your solution here\n  return "";\n}',
    testCases: [
      { input: { nums: [10, 2] }, expected: '210' },
      { input: { nums: [3, 30, 34, 5, 9] }, expected: '9534330' },
      { input: { nums: [0, 0] }, expected: '0' },
      { input: { nums: [1] }, expected: '1' },
      { input: { nums: [8308, 830] }, expected: '8308830' },
    ],
    hints: [
      { level: 1, content: 'Convert integers to strings.' },
      {
        level: 2,
        content: 'Custom sort comparator: compare string concatenations (b + a) vs (a + b).',
      },
      { level: 3, content: 'Edge case: if the highest number is "0", return "0".' },
    ],
    solution: {
      code: 'function solve(input) {\n  const { nums } = input;\n  const strs = nums.map(String);\n  strs.sort((a, b) => (b + a).localeCompare(a + b));\n  if (strs[0] === "0") return "0";\n  return strs.join("");\n}',
      explanation:
        'Custom comparator sorting (b + a) against (a + b) greedily orders numbers to form the maximum combination.\nTime Complexity: O(n log n)\nSpace Complexity: O(n)',
    },
  },

  // =========================================================================
  // TOPIC 8: Searching
  // =========================================================================
  {
    id: 'binary-search',
    title: 'Binary Search',
    topic: 'Searching',
    difficulty: 'Easy',
    description:
      'Given an array of integers `nums` which is sorted in ascending order, and an integer `target`, write a function to search `target` in `nums`. If `target` exists, then return its index. Otherwise, return `-1`. You must write an algorithm with O(log n) runtime complexity.',
    starterCode:
      'function solve(input) {\n  const { nums, target } = input;\n  // Your solution here\n  return -1;\n}',
    testCases: [
      { input: { nums: [-1, 0, 3, 5, 9, 12], target: 9 }, expected: 4 },
      { input: { nums: [-1, 0, 3, 5, 9, 12], target: 2 }, expected: -1 },
      { input: { nums: [5], target: 5 }, expected: 0 },
      { input: { nums: [5], target: -5 }, expected: -1 },
      { input: { nums: [1, 2, 3, 4, 5, 6, 7, 8], target: 1 }, expected: 0 },
    ],
    hints: [
      { level: 1, content: 'Divide search space in half at each step with low and high pointers.' },
      { level: 2, content: 'mid = Math.floor((low + high) / 2).' },
      {
        level: 3,
        content: 'If nums[mid] === target return mid; else adjust low = mid + 1 or high = mid - 1.',
      },
    ],
    solution: {
      code: 'function solve(input) {\n  const { nums, target } = input;\n  let low = 0, high = nums.length - 1;\n  while (low <= high) {\n    const mid = Math.floor((low + high) / 2);\n    if (nums[mid] === target) return mid;\n    if (nums[mid] < target) low = mid + 1;\n    else high = mid - 1;\n  }\n  return -1;\n}',
      explanation:
        'Standard binary search halving the interval each step.\nTime Complexity: O(log n)\nSpace Complexity: O(1)',
    },
  },
  {
    id: 'search-a-2d-matrix',
    title: 'Search a 2D Matrix',
    topic: 'Searching',
    difficulty: 'Medium',
    description:
      'You are given an `m x n` integer matrix `matrix` with the properties: integers in each row are sorted from left to right, and the first integer of each row is greater than the last integer of the previous row. Given an integer `target`, return `true` if `target` is in `matrix` or `false` otherwise.',
    starterCode:
      'function solve(input) {\n  const { matrix, target } = input;\n  // Your solution here\n  return false;\n}',
    testCases: [
      {
        input: {
          matrix: [
            [1, 3, 5, 7],
            [10, 11, 16, 20],
            [23, 30, 34, 60],
          ],
          target: 3,
        },
        expected: true,
      },
      {
        input: {
          matrix: [
            [1, 3, 5, 7],
            [10, 11, 16, 20],
            [23, 30, 34, 60],
          ],
          target: 13,
        },
        expected: false,
      },
      { input: { matrix: [[1]], target: 1 }, expected: true },
      { input: { matrix: [[1]], target: 2 }, expected: false },
      { input: { matrix: [[1, 3]], target: 3 }, expected: true },
    ],
    hints: [
      { level: 1, content: 'Treat the m x n matrix as a single 1D sorted array of length m * n.' },
      {
        level: 2,
        content: 'Map 1D index mid to 2D coordinates: row = Math.floor(mid / n), col = mid % n.',
      },
      { level: 3, content: 'Binary search over 0 to (m * n - 1).' },
    ],
    solution: {
      code: 'function solve(input) {\n  const { matrix, target } = input;\n  if (!matrix || matrix.length === 0) return false;\n  const m = matrix.length, n = matrix[0].length;\n  let low = 0, high = m * n - 1;\n  while (low <= high) {\n    const mid = Math.floor((low + high) / 2);\n    const val = matrix[Math.floor(mid / n)][mid % n];\n    if (val === target) return true;\n    if (val < target) low = mid + 1;\n    else high = mid - 1;\n  }\n  return false;\n}',
      explanation:
        'Virtual 1D array binary search indexed with row = mid / n, col = mid % n.\nTime Complexity: O(log(m * n))\nSpace Complexity: O(1)',
    },
  },
  {
    id: 'find-minimum-in-rotated-sorted-array',
    title: 'Find Minimum in Rotated Sorted Array',
    topic: 'Searching',
    difficulty: 'Medium',
    description:
      'Suppose an array of length `n` sorted in ascending order is rotated between 1 and `n` times. Given the sorted rotated array `nums` of unique elements, return the minimum element of this array. You must write an algorithm that runs in O(log n) time.',
    starterCode:
      'function solve(input) {\n  const { nums } = input;\n  // Your solution here\n  return 0;\n}',
    testCases: [
      { input: { nums: [3, 4, 5, 1, 2] }, expected: 1 },
      { input: { nums: [4, 5, 6, 7, 0, 1, 2] }, expected: 0 },
      { input: { nums: [11, 13, 15, 17] }, expected: 11 },
      { input: { nums: [2, 1] }, expected: 1 },
      { input: { nums: [1] }, expected: 1 },
    ],
    hints: [
      { level: 1, content: 'Compare nums[mid] with nums[high].' },
      {
        level: 2,
        content:
          'If nums[mid] > nums[high], the inflection point (minimum) is in the right half: low = mid + 1.',
      },
      { level: 3, content: 'Else, minimum is at or left of mid: high = mid.' },
    ],
    solution: {
      code: 'function solve(input) {\n  const { nums } = input;\n  let low = 0, high = nums.length - 1;\n  while (low < high) {\n    const mid = Math.floor((low + high) / 2);\n    if (nums[mid] > nums[high]) low = mid + 1;\n    else high = mid;\n  }\n  return nums[low];\n}',
      explanation:
        'Binary search finding inflection point by comparing mid element with high bound.\nTime Complexity: O(log n)\nSpace Complexity: O(1)',
    },
  },
  {
    id: 'search-in-rotated-sorted-array',
    title: 'Search in Rotated Sorted Array',
    topic: 'Searching',
    difficulty: 'Medium',
    description:
      'There is an integer array `nums` sorted in ascending order (with distinct values) that is rotated at an unknown pivot. Given the array `nums` and an integer `target`, return the index of `target` if it is in `nums`, or `-1` if it is not in `nums`. Algorithm must run in O(log n) time.',
    starterCode:
      'function solve(input) {\n  const { nums, target } = input;\n  // Your solution here\n  return -1;\n}',
    testCases: [
      { input: { nums: [4, 5, 6, 7, 0, 1, 2], target: 0 }, expected: 4 },
      { input: { nums: [4, 5, 6, 7, 0, 1, 2], target: 3 }, expected: -1 },
      { input: { nums: [1], target: 0 }, expected: -1 },
      { input: { nums: [1, 3], target: 3 }, expected: 1 },
      { input: { nums: [5, 1, 3], target: 5 }, expected: 0 },
    ],
    hints: [
      {
        level: 1,
        content: 'At least one half (left or right) of the array is always normally sorted.',
      },
      { level: 2, content: 'Check if target lies within the boundaries of the sorted half.' },
      {
        level: 3,
        content: 'If target is within sorted half, search there; otherwise search the other half.',
      },
    ],
    solution: {
      code: 'function solve(input) {\n  const { nums, target } = input;\n  let low = 0, high = nums.length - 1;\n  while (low <= high) {\n    const mid = Math.floor((low + high) / 2);\n    if (nums[mid] === target) return mid;\n    if (nums[low] <= nums[mid]) {\n      if (nums[low] <= target && target < nums[mid]) high = mid - 1;\n      else low = mid + 1;\n    } else {\n      if (nums[mid] < target && target <= nums[high]) low = mid + 1;\n      else high = mid - 1;\n    }\n  }\n  return -1;\n}',
      explanation:
        'Identify which half is sorted, then determine if the target lies within that half.\nTime Complexity: O(log n)\nSpace Complexity: O(1)',
    },
  },
  {
    id: 'median-of-two-sorted-arrays',
    title: 'Median of Two Sorted Arrays',
    topic: 'Searching',
    difficulty: 'Hard',
    description:
      'Given two sorted arrays `nums1` and `nums2` of size `m` and `n` respectively, return the median of the two sorted arrays. The overall run time complexity should be O(log (m+n)).',
    starterCode:
      'function solve(input) {\n  const { nums1, nums2 } = input;\n  // Your solution here\n  return 0.0;\n}',
    testCases: [
      { input: { nums1: [1, 3], nums2: [2] }, expected: 2.0 },
      { input: { nums1: [1, 2], nums2: [3, 4] }, expected: 2.5 },
      { input: { nums1: [0, 0], nums2: [0, 0] }, expected: 0.0 },
      { input: { nums1: [], nums2: [1] }, expected: 1.0 },
      { input: { nums1: [2], nums2: [] }, expected: 2.0 },
    ],
    hints: [
      {
        level: 1,
        content: 'Partition both arrays such that left half has (m + n + 1) / 2 elements.',
      },
      { level: 2, content: 'Binary search the partition index on the smaller array.' },
      {
        level: 3,
        content:
          'Check if maxLeft1 <= minRight2 and maxLeft2 <= minRight1. If so, calculate median.',
      },
    ],
    solution: {
      code: 'function solve(input) {\n  let { nums1, nums2 } = input;\n  if (nums1.length > nums2.length) [nums1, nums2] = [nums2, nums1];\n  const m = nums1.length, n = nums2.length;\n  let low = 0, high = m;\n  while (low <= high) {\n    const i = Math.floor((low + high) / 2);\n    const j = Math.floor((m + n + 1) / 2) - i;\n    const maxL1 = i === 0 ? -Infinity : nums1[i - 1];\n    const minR1 = i === m ? Infinity : nums1[i];\n    const maxL2 = j === 0 ? -Infinity : nums2[j - 1];\n    const minR2 = j === n ? Infinity : nums2[j];\n    if (maxL1 <= minR2 && maxL2 <= minR1) {\n      if ((m + n) % 2 === 1) return Math.max(maxL1, maxL2);\n      return (Math.max(maxL1, maxL2) + Math.min(minR1, minR2)) / 2;\n    } else if (maxL1 > minR2) {\n      high = i - 1;\n    } else {\n      low = i + 1;\n    }\n  }\n  return 0;\n}',
      explanation:
        'Binary search partition on the smaller array ensuring max(left) <= min(right).\nTime Complexity: O(log(min(m, n)))\nSpace Complexity: O(1)',
    },
  },
];
