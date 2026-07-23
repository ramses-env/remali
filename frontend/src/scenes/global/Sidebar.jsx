import { useState } from "react";
import { Sidebar as ProSidebar, Menu, MenuItem } from "react-pro-sidebar";
import { Box, IconButton, Typography, useTheme } from "@mui/material";
import { Link } from "react-router-dom";
import { tokens } from "../../theme";
import HomeOutlinedIcon from "@mui/icons-material/HomeOutlined";
import PeopleOutlinedIcon from "@mui/icons-material/PeopleOutlined";
import ContactsOutlinedIcon from "@mui/icons-material/ContactsOutlined";
import ReceiptOutlinedIcon from "@mui/icons-material/ReceiptOutlined";
import PersonOutlinedIcon from "@mui/icons-material/PersonOutlined";
import CalendarTodayOutlinedIcon from "@mui/icons-material/CalendarTodayOutlined";
import HelpOutlineOutlinedIcon from "@mui/icons-material/HelpOutlineOutlined";
import BarChartOutlinedIcon from "@mui/icons-material/BarChartOutlined";
import PieChartOutlineOutlinedIcon from "@mui/icons-material/PieChartOutlineOutlined";
import TimelineOutlinedIcon from "@mui/icons-material/TimelineOutlined";
import MenuOutlinedIcon from "@mui/icons-material/MenuOutlined";
import MapOutlinedIcon from "@mui/icons-material/MapOutlined";

const Item = ({ title, to, icon, selected, setSelected }) => {
  const theme = useTheme();
  const colors = tokens(theme.palette.mode);
  return (
    <MenuItem
      active={selected === title}
      rootStyles={{
        color: colors.grey[100],
      }}
      onClick={() => setSelected(title)}
      icon={icon}
      component={<Link to={to} />}
    >
      <Typography>{title}</Typography>
    </MenuItem>
  );
};

const Sidebar = () => {
  const theme = useTheme();
  const colors = tokens(theme.palette.mode);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [selected, setSelected] = useState("Dashboard");

  return (
    <Box
      sx={{
        "& .ps-sidebar-container": {
          background: `${colors.primary[400]} !important`,
        },
        "& .ps-menu-icon": {
          backgroundColor: "transparent !important",
        },
        "& .ps-menu-button": {
          padding: "5px 35px 5px 20px !important",
        },
        "& .ps-menu-button:hover": {
          color: "#868dfb !important",
        },
        "& .ps-active": {
          color: "#6870fa !important",
        },
      }}
      style={{ height: "100%" }}
    >
      <ProSidebar collapsed={isCollapsed}>
        <Menu>
          {/* LOGO AND MENU ICON */}
          <MenuItem
            onClick={() => setIsCollapsed(!isCollapsed)}
            icon={isCollapsed ? <MenuOutlinedIcon /> : undefined}
            rootStyles={{
              margin: "10px 0 20px 0",
              color: colors.grey[100],
            }}
          >
            {!isCollapsed && (
              <Box
                display="flex"
                justifyContent="space-between"
                alignItems="center"
                ml="15px"
              >
                <Typography variant="h3" color={colors.grey[100]}>
                  ADMINIS
                </Typography>
                <IconButton onClick={() => setIsCollapsed(!isCollapsed)}>
                  <MenuOutlinedIcon />
                </IconButton>
              </Box>
            )}
          </MenuItem>
        </Menu>

        {!isCollapsed && (
          <Box mb="25px">
            <Box display="flex" justifyContent="center" alignItems="center">
              <img
                alt="profile-user"
                width="100px"
                height="100px"
                src={`/assets/user.png`}
                style={{ cursor: "pointer", borderRadius: "50%" }}
              />
            </Box>
            <Box textAlign="center">
              <Typography
                variant="h2"
                color={colors.grey[100]}
                fontWeight="bold"
                sx={{ m: "10px 0 0 0" }}
              >
                Ed Roh
              </Typography>
              <Typography variant="h5" color={colors.greenAccent[500]}>
                VP Fancy Admin
              </Typography>
            </Box>
          </Box>
        )}

        <Box paddingLeft={isCollapsed ? undefined : "10%"}>
          <Menu>
            <Item
              title="Dashboard"
              to="/dashboard"
              icon={<HomeOutlinedIcon />}
              selected={selected}
              setSelected={setSelected}
            />
          </Menu>

          <Typography
            variant="h6"
            color={colors.grey[300]}
            sx={{ m: "15px 0 5px 20px" }}
          >
            Data
          </Typography>
          <Menu>
            <Item
              title="Manage Team"
              to="/dashboard/team"
              icon={<PeopleOutlinedIcon />}
              selected={selected}
              setSelected={setSelected}
            />
            <Item
              title="Contacts Information"
              to="/dashboard/contacts"
              icon={<ContactsOutlinedIcon />}
              selected={selected}
              setSelected={setSelected}
            />
            <Item
              title="Invoices Balances"
              to="/dashboard/invoices"
              icon={<ReceiptOutlinedIcon />}
              selected={selected}
              setSelected={setSelected}
            />
          </Menu>

          <Typography
            variant="h6"
            color={colors.grey[300]}
            sx={{ m: "15px 0 5px 20px" }}
          >
            Pages
          </Typography>
          <Menu>
            <Item
              title="Profile Form"
              to="/dashboard/form"
              icon={<PersonOutlinedIcon />}
              selected={selected}
              setSelected={setSelected}
            />
            <Item
              title="Calendar"
              to="/dashboard/calendar"
              icon={<CalendarTodayOutlinedIcon />}
              selected={selected}
              setSelected={setSelected}
            />
            <Item
              title="FAQ Page"
              to="/dashboard/faq"
              icon={<HelpOutlineOutlinedIcon />}
              selected={selected}
              setSelected={setSelected}
            />
          </Menu>

          <Typography
            variant="h6"
            color={colors.grey[300]}
            sx={{ m: "15px 0 5px 20px" }}
          >
            Charts
          </Typography>
          <Menu>
            <Item
              title="Bar Chart"
              to="/dashboard/bar"
              icon={<BarChartOutlinedIcon />}
              selected={selected}
              setSelected={setSelected}
            />
            <Item
              title="Pie Chart"
              to="/dashboard/pie"
              icon={<PieChartOutlineOutlinedIcon />}
              selected={selected}
              setSelected={setSelected}
            />
            <Item
              title="Line Chart"
              to="/dashboard/line"
              icon={<TimelineOutlinedIcon />}
              selected={selected}
              setSelected={setSelected}
            />
            <Item
              title="Geography Chart"
              to="/dashboard/geography"
              icon={<MapOutlinedIcon />}
              selected={selected}
              setSelected={setSelected}
            />
          </Menu>
        </Box>
      </ProSidebar>
    </Box>
  );
};

export default Sidebar;
