const express = require("express");

const app = express();
const port = 3000;

app.use(express.json());


// Mock liquidity pool state (replace with actual blockchain data in production)
let pool = {
  ethBalance: 1000, // Initial ETH in pool
  usdcBalance: 1000000, // Initial USDC in pool (1 ETH = 1000 USDC)
  constantK: 1000 * 1000000, // x * y = k for AMM
};


// Helper function to calculate impermanent loss (simplified)
function calculateImpermanentLoss(initialPrice, newPrice, ethAmount, usdcAmount) {
  const initialValue = ethAmount * initialPrice + usdcAmount;
  const newEthValue = ethAmount * newPrice;
  const newUsdcValue = usdcAmount;
  const newTotalValue = newEthValue + newUsdcValue;
  const holdValue = ethAmount * newPrice + usdcAmount;
  return ((holdValue - newTotalValue) / holdValue) * 100; // % loss
}

//Route to add liquidity to the pool
app.post("/add-liquidity" , (req,res)=>{
    try{
        //validate request body
        const {ethQuantity ,usdcQuantity } = req.body;

        //check for undefined or missing quantities 
        if(!ethQuantity || !usdcQuantity){
            return res.status(400).json({
                error: " both ethQunatity and usdcQuantity are required",
            });
        }
        
        //validate numeric values
        if(isNaN(ethQuantity) || isNaN(usdcQuantity) || ethQuantity <= 0 || usdcQuantity <= 0){
            return res.status(400).json({
                error: "Quantities must be postive numbers"
            });
        }

        //check if quantities match current pool ratio ( 1 ETH = 1000 USDC)
        const currentPrice = pool.usdcBalance/pool.ethBalance; //current pool price 
        const expectedUsdc =  ethQuantity * currentPrice;
        if(Math.abs(usdcQuantity - expectedUsdc)> 0.01){
            return res.status(400).json({
                error:`USDC quantity must match pool ratio  (expected ~${expectedUsdc.toFixed(2)} USDC for ${ethQuantity} ETH)`,
            });
        }
    

    //add liquidity to the pool
    pool.ethBalance += ethQuantity;
    pool.usdcBalance += usdcQuantity;
    pool.constantK = pool.ethBalance*pool.usdcBalance;//update constant

    //calculate potential impermanent loss (example with 50% ETH price increase)
    const initialPrice = currentPrice // 1000 usdc/eth
    const newPrice = initialPrice * 1.5; // 50% price increse (1500 usdc/eth)
    const impermanentLoss = calculateImpermanentLoss(initialPrice,newPrice,ethQuantity,usdcQuantity);

    res.json({
        message : `added ${ethQuantity} ETH and ${usdcQuantity} USDC to the pool`,
        impermanentLoss :`potential impermanent loss with 50% ETH price increse : ${impermanentLoss.toFixed(2)}%`,
        poolState:{
            ethBalance : pool.ethBalance,
            usdcBalance : pool.usdcBalance,
            currentPrice :(pool.usdcBalance / pool.ethBalance).toFixed(2),
        },
    });

    }catch(error){
        console.error("error in add-liquidity :",error);
        res.status(500).json({error:"internal server error"});
    }
});


//route to buy ETH (swap USDC for ETH)
app.post("/buy-asset",(req,res)=>{
   try {

    const {usdcQuantity} =  req.body;

    if(!usdcQuantity || isNaN(usdcQuantity) || usdcQuantity <= 0){
        return res.status(400).json({error : "valid USDC quantity is required"});
    }

    //calculate ETH to receive using constant product formula
    const product = pool.ethBalance * pool.usdcBalance;
    const updatedUsdcBalance = pool.usdcBalance + usdcQuantity;
    const updatedEthBalance = product / updatedUsdcBalance;
    const ethReceived = pool.ethBalance - updatedEthBalance;

    //update pool
    pool.ethBalance = updatedEthBalance;
    pool.usdcBalance = updatedUsdcBalance;
    pool.constantK = pool.ethBalance * pool.usdcBalance;

    res.json({
      message: `You paid ${usdcQuantity} USDC for ${ethReceived.toFixed(6)} ETH`,
      newPrice: (pool.usdcBalance / pool.ethBalance).toFixed(2),
    });
    
   } catch (error) {
    console.error("Error in buy-asset:", error);
    res.status(500).json({ error: "Internal server error" });
  }
    
});

// routed to sell ETH ( Swap ETH for USDC)
app.post("/sell-asset",(req,res)=>{
      try {
        const {ethQuantity} = req.body;
        
        if(!ethQuantity ||isNaN(ethQuantity)|| ethQuantity <= 0){
            return res.status(400).json({
                error: "valid Eth quantity is required"
            });
        }

        //calculate usdc to receive usign constant product formula
        const product = pool.ethBalance * pool.usdcBalance;
        const updatedEthBalance = pool.ethBalance + ethQuantity ;
        const updatedUsdcBalance = product/updatedEthBalance;
        const usdcReceived = pool.usdcBalance - updatedUsdcBalance;

        //update pool
        pool.ethBalance = updatedEthBalance;
        pool.usdcBalance = updatedUsdcBalance;
        pool.constantK = pool.ethBalance * pool.usdcBalance;

        res.json({
            message :`you got ${usdcReceived.toFixed(2)} USDC for ${ethQuantity} ETH`,
            newPrice : (pool.usdcBalance / pool.ethBalance).toFixed(2),
        });

      } catch (error) {
        console.error("Error in sell-asset:", error);
        res.status(500).json({ error: "Internal server error" });
        
      }
});


// Route to get a quote for a swap
app.post("/quote",(req ,res)=>{
    try {
        const {ethQuantity , usdcQuantity , tradeType } =  req.body;

        if(!tradeType ||!["buy" , "sell"].includes(tradeType)){
            return res.status(400).json({error:"valid tradeType (buy or sell) is required "});
        }

        if(tradeType === "buy" && (!usdcQuantity || isNaN(usdcQuantity) || usdcQuantity <= 0)){
            return res.status(400).json({error : "valid USDC quantity is required for buy "});
        }

        if(tradeType === "sell" && (!ethQuantity || isNaN(ethQuantity) || ethQuantity <= 0)){
            return res.status(400).json({error : "Valid ETH quantity is required for sell"});
        }

        let amountReceived;
        if(tradeType === "buy"){
            const product = pool.ethBalance * pool.usdcBalance;
            const updatedUsdcBalance = pool.usdcBalance + usdcQuantity;
            const updatedEthBalance = product / updatedEthBalance;
            amountReceived = pool.ethBalance - updatedEthBalance;

            res.json({
                message : `you will receive ${amountReceived.toFixed(6)} ETH for ${usdcQuantity} USDC`,
                priceImpact: (((pool.usdcBalance / pool.ethBalance) - (updatedUsdcBalance / updatedEthBalance)) / (pool.usdcBalance / pool.ethBalance) * 100).toFixed(2) + "%",
            });
        }else{
            const product = pool.ethBalance * pool.usdcBalance;
            const updatedEthBalance = pool.ethBalance +ethQuantity;
            const updatedUsdcBalance = product / updatedEthBalance;
            amountReceived = pool.usdcBalance - updatedUsdcBalance;
            res.json({
                 message: `You will receive ${amountReceived.toFixed(2)} USDC for ${ethQuantity} ETH`,
                 priceImpact: (((pool.usdcBalance / pool.ethBalance) - (updatedUsdcBalance / updatedEthBalance)) / (pool.usdcBalance / pool.ethBalance) * 100).toFixed(2) + "%",
      });
     }   
    } catch (error) {
         console.error("Error in quote:", error);
         res.status(500).json({ error: "Internal server error" });   
    }
});


app.listen(port, () => {
  console.log(`DEX server running on port ${port}`);
});