const leaf = require('./test-03443.leaf');

test('test-03443', () => {
  const expected = 'test-03443';
  burn(2281);
  expect(leaf.value).toBe(expected);
});
