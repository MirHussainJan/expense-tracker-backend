// controllers/expenseController.js
const Group = require('../models/Group');
const Expense = require('../models/Expense');

exports.addExpense = async (req, res) => {
  const { groupId, expenseName, totalAmount, splitType, splitDetails } = req.body;

  try {
    const balances = [];

    if (splitType === 'percentage') {
      // Calculate amounts based on percentage split
      splitDetails.forEach((split) => {
        const amountOwed = (split.percentage / 100) * totalAmount;
        balances.push({
          user: split.user,
          amount: amountOwed,
        });
        split.amount = amountOwed; // Save amount to splitDetails for consistency
      });
    } else if (splitType === 'exact') {
      // Use exact amounts directly from splitDetails
      splitDetails.forEach((split) => {
        balances.push({
          user: split.user,
          amount: split.amount,
        });
      });
    } else if (splitType === 'equally') {
      // Split totalAmount equally among all users in splitDetails
      const equalAmount = totalAmount / splitDetails.length;
      splitDetails.forEach((split) => {
        balances.push({
          user: split.user,
          amount: equalAmount,
        });
        split.amount = equalAmount; // Save amount to splitDetails for consistency
      });
    } else {
      return res.status(400).json({ error: 'Invalid split type' });
    }

    // Create and save the expense
    const expense = new Expense({
      expenseName,
      totalAmount,
      group: groupId,
      createdBy: req.user.id,
      splitDetails, // Store split details
      balances, // Store balances
    });

    await expense.save();

    // Update the group's expenses
    const group = await Group.findById(groupId);
    group.expenses.push(expense._id);
    await group.save();

    res.status(201).json({ message: 'Expense added successfully', expense });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add expense', details: err.message });
  }
};


exports.getAllExpenses = async (req, res) => {
  try {
    const expenses = await Expense.find({ group: req.params.groupId }).populate('createdBy', 'name').exec();
      res.status(200).json(expenses);
      } catch (err) {
      res.status(500).json({ error: 'Failed to fetch expenses', details: err.message });
      }
    };

exports.settleUp = async (req, res) => {
  const { groupId, withUser, amount } = req.body;
  try {
    const group = await Group.findById(groupId);
    const userBalance = group.balances.find(b => b.user.toString() === req.user.id);
    if (userBalance) {
      const balanceIndex = userBalance.owesTo.findIndex(
        o => o.to.toString() === withUser
      );
      if (balanceIndex >= 0) {
        userBalance.owesTo[balanceIndex].amount -= amount;
        if (userBalance.owesTo[balanceIndex].amount <= 0) {
          userBalance.owesTo.splice(balanceIndex, 1);
        }
      }
    }
    await group.save();
    res.status(200).json({ message: 'Settled up successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to settle up', details: err.message });
  }
};

// Fetch amounts user owes and others owe to the user
exports.getUserOweDetails = async (req, res) => {
  try {
    const {userId} = req.body; // Assuming user ID is available in `req.user`

    // Fetch amounts the user owes to others
    const owedByUser = await Expense.aggregate([
      { $unwind: '$splitDetails' },
      { $match: { 'splitDetails.user': userId } },
      {
        $group: {
          _id: '$createdBy',
          totalOwed: { $sum: '$splitDetails.amount' },
        },
      },
      {
        $lookup: {
          from: 'users', // Assuming 'users' is the name of the User collection
          localField: '_id',
          foreignField: '_id',
          as: 'createdByUser',
        },
      },
      {
        $project: {
          _id: 0,
          createdBy: { $arrayElemAt: ['$createdByUser.name', 0] }, // Fetching name
          totalOwed: 1,
        },
      },
    ]);

    // Fetch amounts others owe to the user
    const owedToUser = await Expense.aggregate([
      { $unwind: '$splitDetails' },
      { $match: { createdBy: userId } },
      {
        $group: {
          _id: '$splitDetails.user',
          totalOwedTo: { $sum: '$splitDetails.amount' },
        },
      },
      {
        $lookup: {
          from: 'users', // Assuming 'users' is the name of the User collection
          localField: '_id',
          foreignField: '_id',
          as: 'owedByUser',
        },
      },
      {
        $project: {
          _id: 0,
          owedBy: { $arrayElemAt: ['$owedByUser.name', 0] }, // Fetching name
          totalOwedTo: 1,
        },
      },
    ]);

    res.status(200).json({ owedByUser, owedToUser });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error', error });
  }
};
