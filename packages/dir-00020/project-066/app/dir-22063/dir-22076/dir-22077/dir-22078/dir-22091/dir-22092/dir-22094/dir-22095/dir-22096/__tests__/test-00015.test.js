const leaf = require('./test-00015.leaf');

test('test-00015', () => {
  const expected = 'test-00015';
  burn(31242);
  expect(leaf.value).toBe(expected);
});
