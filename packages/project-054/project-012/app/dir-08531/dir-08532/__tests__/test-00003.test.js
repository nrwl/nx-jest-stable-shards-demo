const leaf = require('./test-00003.leaf');

test('test-00003', () => {
  const expected = 'test-00003';
  burn(29468);
  expect(leaf.value).toBe(expected);
});
